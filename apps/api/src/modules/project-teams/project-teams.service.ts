import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, DOMAIN_EVENTS, roleLabel, type ProjectTeamLinkDto } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  AdminGrantRequiresAdminException,
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';
import { AuditService } from '../audit/audit.service';
import { touchedAdminRoleIds } from '../rbac/admin-grant';
import { RbacService } from '../rbac/rbac.service';
import { lockProjectRoles, lockTeamRoles, reconcileTeamRoles } from './project-role-sources';

type Tx = Prisma.TransactionClient;

/** Kết quả đồng bộ MỘT liên kết (team, dự án): ai vừa vào / ra dự án, ai đổi vai trò, ai được giữ lại. */
export interface LinkSyncEffect {
  projectId: string;
  projectName: string;
  teamId: string;
  teamName: string;
  added: string[];
  removed: string[];
  changed: string[];
  kept: string[];
}

const TX_OPTS = { maxWait: 10_000, timeout: 60_000 } as const;

/**
 * Team của tổ chức GẮN vào dự án: mọi thành viên team là thành viên dự án với các vai trò đã chọn và tự đồng bộ khi team đổi người.
 * Nguồn vai trò xem `project-role-sources.ts`: gỡ team / bớt người chỉ gỡ phần vai trò NHỜ TEAM đó, vai trò gán trực tiếp và vai trò
 * nhờ team khác được giữ. Mọi đồng bộ chạy theo TRẠNG THÁI hiện có (không theo "diff") trong transaction, sau khoá tư vấn theo dự án.
 */
@Injectable()
export class ProjectTeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── API theo dự án ─────────────────────────

  async list(organizationId: string, projectId: string): Promise<ProjectTeamLinkDto[]> {
    await this.requireProject(organizationId, projectId);
    const links = await this.prisma.projectTeamLink.findMany({
      where: { projectId, team: { organizationId, deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        projectId: true,
        teamId: true,
        roleIds: true,
        createdAt: true,
        team: {
          select: {
            id: true,
            name: true,
            key: true,
            color: true,
            _count: { select: { members: true } },
          },
        },
      },
    });
    const roles = await this.prisma.role.findMany({
      where: { id: { in: [...new Set(links.flatMap((l) => l.roleIds))] } },
      select: { id: true, name: true, color: true },
    });
    const byId = new Map(roles.map((r) => [r.id, r]));
    return links.map((l) => ({
      id: l.id,
      projectId: l.projectId,
      teamId: l.teamId,
      team: {
        id: l.team.id,
        name: l.team.name,
        key: l.team.key,
        color: l.team.color,
        memberCount: l.team._count.members,
      },
      roles: l.roleIds.flatMap((id) => {
        const r = byId.get(id);
        return r ? [{ id: r.id, name: r.name, color: r.color }] : [];
      }),
      createdAt: l.createdAt.toISOString(),
    }));
  }

  /** Gắn team vào dự án, hoặc đổi vai trò nếu đã gắn. Mọi thành viên team (còn hoạt động) được đồng bộ ngay. */
  async link(
    organizationId: string,
    projectId: string,
    teamId: string,
    roleIds: string[],
    actorId: string,
  ): Promise<ProjectTeamLinkDto[]> {
    const project = await this.requireProject(organizationId, projectId);
    const team = await this.requireTeam(organizationId, teamId);
    const ids = await this.validateRoles(organizationId, roleIds);
    // Cả hai chiều (thêm VÀ gỡ vai trò mang quyền quản trị tổ chức) chỉ quản trị tổ chức làm được, như `MembersService`.
    const current = await this.prisma.projectTeamLink.findUnique({
      where: { projectId_teamId: { projectId, teamId } },
      select: { roleIds: true },
    });
    await this.assertMayGrant(organizationId, actorId, current?.roleIds ?? [], ids);

    const { effect, existed, before } = await this.prisma.$transaction(async (tx) => {
      await lockTeamRoles(tx, teamId);
      await lockProjectRoles(tx, projectId);
      const prev = await tx.projectTeamLink.findUnique({
        where: { projectId_teamId: { projectId, teamId } },
        select: { roleIds: true },
      });
      await tx.projectTeamLink.upsert({
        where: { projectId_teamId: { projectId, teamId } },
        create: { projectId, teamId, roleIds: ids, createdById: actorId },
        update: { roleIds: ids },
      });
      const e = await this.syncLink(tx, organizationId, project, team, ids);
      return { effect: e, existed: !!prev, before: prev?.roleIds ?? [] };
    }, TX_OPTS);

    await this.publish(organizationId, [effect], actorId);
    const names = await this.roleNames(ids);
    await this.audit.record({
      organizationId,
      actorId,
      action: existed
        ? AUDIT_ACTIONS.PROJECT_TEAM_ROLES_CHANGED
        : AUDIT_ACTIONS.PROJECT_TEAM_LINKED,
      entityType: 'team',
      entityId: teamId,
      summary: existed
        ? `Đổi vai trò của team "${team.name}" trong dự án "${project.name}" thành ${names}`
        : `Gắn team "${team.name}" vào dự án "${project.name}" với vai trò ${names}`,
      meta: { projectId, teamId, roleIds: ids, previousRoleIds: before },
    });
    return this.list(organizationId, projectId);
  }

  /** Gỡ team khỏi dự án: chỉ gỡ phần vai trò NHỜ TEAM này; vai trò gán trực tiếp / nhờ team khác được giữ. */
  async unlink(
    organizationId: string,
    projectId: string,
    teamId: string,
    actorId: string,
  ): Promise<ProjectTeamLinkDto[]> {
    const project = await this.requireProject(organizationId, projectId);
    const team = await this.requireTeam(organizationId, teamId);
    const current = await this.prisma.projectTeamLink.findUnique({
      where: { projectId_teamId: { projectId, teamId } },
      select: { roleIds: true },
    });
    if (!current) throw new NotFoundAppException('Liên kết team với dự án');
    await this.assertMayGrant(organizationId, actorId, current.roleIds, []);

    const effect = await this.prisma.$transaction(async (tx) => {
      await lockTeamRoles(tx, teamId);
      await lockProjectRoles(tx, projectId);
      const prev = await tx.projectTeamLink.findUnique({
        where: { projectId_teamId: { projectId, teamId } },
        select: { id: true },
      });
      if (!prev) throw new NotFoundAppException('Liên kết team với dự án');
      const e = await this.syncLink(tx, organizationId, project, team, []);
      if (e.kept.length > 0)
        throw new BusinessRuleException(
          'Dự án riêng tư phải còn ít nhất một thành viên — hãy thêm người khác vào dự án trước khi gỡ team này',
        );
      await tx.projectTeamLink.delete({ where: { id: prev.id } });
      return e;
    }, TX_OPTS);

    await this.publish(organizationId, [effect], actorId);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_TEAM_UNLINKED,
      entityType: 'team',
      entityId: teamId,
      summary: `Gỡ team "${team.name}" khỏi dự án "${project.name}"`,
      meta: { projectId, teamId, removedUserIds: effect.removed, changedUserIds: effect.changed },
    });
    return this.list(organizationId, projectId);
  }

  // ───────────────────────── Móc từ team (TeamsService) ─────────────────────────

  /**
   * Đồng bộ MỌI dự án đang gắn team theo danh sách thành viên hiện tại — gọi TRONG transaction thay đổi team (thêm/bớt người). Theo
   * trạng thái nên không cần biết ai vừa vào/ra. Dự án được khoá theo thứ tự projectId để hai đồng bộ đồng thời không kẹt vòng.
   */
  async syncTeam(tx: Tx, organizationId: string, teamId: string): Promise<LinkSyncEffect[]> {
    await lockTeamRoles(tx, teamId);
    const links = await tx.projectTeamLink.findMany({
      where: { teamId, project: { organizationId, deletedAt: null } },
      orderBy: { projectId: 'asc' },
      select: {
        projectId: true,
        roleIds: true,
        project: { select: { id: true, name: true, isPrivate: true } },
      },
    });
    if (links.length === 0) return [];
    const team = await tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, name: true },
    });
    const out: LinkSyncEffect[] = [];
    for (const l of links) {
      await lockProjectRoles(tx, l.projectId);
      out.push(await this.syncLink(tx, organizationId, l.project, team, l.roleIds));
    }
    return out;
  }

  /** Xoá team = gỡ team khỏi mọi dự án (gỡ phần vai trò nhờ team, xoá liên kết) — gọi trong transaction xoá team. */
  async unlinkTeamEverywhere(
    tx: Tx,
    organizationId: string,
    teamId: string,
  ): Promise<LinkSyncEffect[]> {
    const links = await tx.projectTeamLink.findMany({
      where: { teamId },
      orderBy: { projectId: 'asc' },
      select: {
        id: true,
        projectId: true,
        project: { select: { id: true, name: true, isPrivate: true } },
      },
    });
    const team = await tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, name: true },
    });
    const out: LinkSyncEffect[] = [];
    for (const l of links) {
      await lockProjectRoles(tx, l.projectId);
      const e = await this.syncLink(tx, organizationId, l.project, team, []);
      if (e.kept.length > 0) {
        // Thành viên cuối của dự án riêng tư không được mất (xem `keptLastOfPrivate`) mà các dòng nguồn team sắp bị xoá theo team (FK cascade):
        // chuyển phần vai trò nhờ team này thành GÁN TRỰC TIẾP để vai trò vẫn có nguồn hợp lệ (không còn dòng mồ côi direct=false).
        await tx.projectMembershipRole.updateMany({
          where: {
            membership: { projectId: l.projectId, userId: { in: e.kept } },
            teamSources: { some: { teamId } },
          },
          data: { direct: true },
        });
      }
      out.push(e);
      await tx.projectTeamLink.delete({ where: { id: l.id } });
    }
    return out;
  }

  /**
   * SAU commit: xoá cache quyền của người bị ảnh hưởng, báo realtime (kiểm lại socket / việc Jira đang chờ) và ghi nhật ký đồng bộ.
   * Không ném lỗi (thao tác chính đã xong).
   */
  async publish(
    organizationId: string,
    effects: LinkSyncEffect[],
    actorId?: string,
  ): Promise<void> {
    const users = new Set<string>();
    for (const e of effects) for (const u of [...e.added, ...e.removed, ...e.changed]) users.add(u);
    for (const u of users) await this.rbac.invalidate(u, organizationId);
    if (users.size > 0)
      this.events.emit(DOMAIN_EVENTS.ACCESS_CHANGED, { organizationId, userIds: [...users] });
    for (const e of effects) {
      if (e.added.length > 0)
        this.events.emit(DOMAIN_EVENTS.PROJECT_ACCESS_CHANGED, {
          organizationId,
          projectId: e.projectId,
          userIds: e.added,
          actorId,
        });
      for (const userId of e.removed)
        this.events.emit(DOMAIN_EVENTS.PROJECT_MEMBER_REMOVED, {
          organizationId,
          projectId: e.projectId,
          userId,
        });
    }
  }

  /** Ghi nhật ký cho đồng bộ do team đổi người / bị xoá (các thao tác gắn/gỡ tự ghi riêng). */
  async auditSync(
    organizationId: string,
    effects: LinkSyncEffect[],
    actorId?: string,
    why = 'team đổi thành viên',
    teamDeleted = false,
  ): Promise<void> {
    for (const e of effects) {
      if (e.added.length + e.removed.length + e.changed.length + e.kept.length === 0) continue;
      await this.audit.record({
        organizationId,
        actorId,
        action: AUDIT_ACTIONS.PROJECT_TEAM_SYNCED,
        entityType: 'team',
        entityId: e.teamId,
        summary:
          `Đồng bộ team "${e.teamName}" vào dự án "${e.projectName}" (${why}): vào dự án ${e.added.length}, ` +
          `ra khỏi dự án ${e.removed.length}, đổi vai trò ${e.changed.length}` +
          (e.kept.length ? `, giữ lại ${e.kept.length} (thành viên cuối của dự án riêng tư)` : ''),
        meta: {
          projectId: e.projectId,
          teamId: e.teamId,
          added: e.added,
          removed: e.removed,
          changed: e.changed,
          kept: e.kept,
          // Xoá team: thành viên cuối của dự án riêng tư giữ lại vai trò, chuyển từ "nhờ team" sang "gán trực tiếp".
          keptPromotedToDirect: teamDeleted ? e.kept : [],
        },
      });
    }
  }

  // ───────────────────────── nội bộ ─────────────────────────

  /**
   * Đưa MỘT liên kết về đúng trạng thái: người đủ điều kiện (thành viên team, còn hoạt động, còn trong tổ chức) có `roleIds`; người
   * từng nhận vai trò nhờ team này mà không còn đủ điều kiện (rời team, vô hiệu hoá, rời tổ chức) bị gỡ phần nhờ team. Đã khoá dự án.
   */
  private async syncLink(
    tx: Tx,
    organizationId: string,
    project: { id: string; name: string; isPrivate: boolean },
    team: { id: string; name: string },
    roleIds: string[],
  ): Promise<LinkSyncEffect> {
    const valid = await tx.role.findMany({
      where: {
        id: { in: roleIds },
        scope: 'PROJECT',
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: { id: true },
    });
    const validSet = new Set(valid.map((r) => r.id));
    const desired = roleIds.filter((r) => validSet.has(r)); // giữ thứ tự: vai trò đầu = vai trò chính
    const eligible = new Set(
      (
        await tx.teamMember.findMany({
          where: {
            teamId: team.id,
            user: {
              status: { not: 'DEACTIVATED' },
              email: { not: SYSTEM_USER_EMAIL },
              organizationMemberships: { some: { organizationId } },
            },
          },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    const holders = await tx.projectMembershipRoleTeam.findMany({
      where: { teamId: team.id, membershipRole: { membership: { projectId: project.id } } },
      select: { membershipRole: { select: { membership: { select: { userId: true } } } } },
    });
    const everyone = new Set([
      ...eligible,
      ...holders.map((h) => h.membershipRole.membership.userId),
    ]);

    const effect: LinkSyncEffect = {
      projectId: project.id,
      projectName: project.name,
      teamId: team.id,
      teamName: team.name,
      added: [],
      removed: [],
      changed: [],
      kept: [],
    };
    for (const userId of [...everyone].sort()) {
      const r = await reconcileTeamRoles(tx, {
        projectId: project.id,
        userId,
        teamId: team.id,
        desiredRoleIds: eligible.has(userId) ? desired : [],
        privateProject: project.isPrivate,
      });
      if (r.keptLastOfPrivate) effect.kept.push(userId);
      if (!r.changed) continue;
      if (r.created) effect.added.push(userId);
      else if (r.removed) effect.removed.push(userId);
      else effect.changed.push(userId);
    }
    return effect;
  }

  private async requireProject(organizationId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true, name: true, isPrivate: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  private async requireTeam(organizationId: string, teamId: string) {
    const t = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!t) throw new NotFoundAppException('Nhóm');
    return t;
  }

  /** Mỗi vai trò phải tồn tại (hệ thống hoặc của tổ chức) và thuộc cấp DỰ ÁN. Giữ thứ tự gốc (vai trò đầu = vai trò chính). */
  private async validateRoles(organizationId: string, roleIds: string[]): Promise<string[]> {
    const unique = [...new Set(roleIds)];
    const found = await this.prisma.role.findMany({
      where: {
        id: { in: unique },
        scope: 'PROJECT',
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: { id: true },
    });
    if (found.length !== unique.length)
      throw new ForbiddenAppException('Một số vai trò không hợp lệ cho cấp dự án');
    const set = new Set(found.map((r) => r.id));
    return unique.filter((id) => set.has(id));
  }

  /** Như `MembersService`: gán vai trò mang `organization:admin` chỉ quản trị tổ chức mới làm được (không leo thang qua team). */
  private async assertMayGrant(
    organizationId: string,
    actorId: string,
    before: string[],
    after: string[],
  ): Promise<void> {
    if (await this.rbac.holdsOrganizationAdmin(actorId, organizationId)) return;
    const admins = await this.rbac.adminRoleIds([...before, ...after]);
    if (touchedAdminRoleIds(before, after, admins).length > 0)
      throw new AdminGrantRequiresAdminException();
  }

  private async roleNames(roleIds: string[]): Promise<string> {
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(roles.map((r) => [r.id, r.name]));
    return roleIds.map((id) => roleLabel(byId.get(id) ?? id)).join(', ') || '—';
  }
}
