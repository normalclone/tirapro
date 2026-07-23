import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { MembersService } from '../members/members.service';
import type { CreateTeamInput, UpdateTeamInput } from './teams.schemas';

const USER_SELECT = {
  id: true, email: true, displayName: true, avatarUrl: true, timezone: true,
  locale: true, status: true, isSystemAdmin: true, lastSeenAt: true, createdAt: true,
} as const;

type UserRow = {
  id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string;
  locale: string; status: string; isSystemAdmin: boolean; lastSeenAt: Date | null; createdAt: Date;
};

const TEAM_SELECT = {
  id: true, workspaceId: true, name: true, key: true, description: true, color: true, createdAt: true,
  lead: { select: USER_SELECT },
  members: { orderBy: { createdAt: 'asc' as const }, select: { user: { select: USER_SELECT } } },
  _count: { select: { members: true } },
} satisfies Prisma.TeamSelect;

/**
 * Nhóm (team) — nhóm thành viên trong workspace, dùng lại khắp dự án & issue.
 * Xoá nhóm = hard delete: Issue.teamId tự về null (FK SET NULL), TeamMember cascade.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
  ) {}

  async list(workspaceId: string) {
    const rows = await this.prisma.team.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: TEAM_SELECT,
    });
    return rows.map((t) => this.toTeamDto(t));
  }

  async get(workspaceId: string, teamId: string) {
    const t = await this.prisma.team.findFirst({ where: { id: teamId, workspaceId, deletedAt: null }, select: TEAM_SELECT });
    if (!t) throw new NotFoundAppException('Nhóm');
    return this.toTeamDto(t);
  }

  async create(workspaceId: string, dto: CreateTeamInput, actingUserId: string) {
    const name = dto.name.trim();
    if (!name) throw new ForbiddenAppException('Tên nhóm bắt buộc');
    await this.assertNameFree(workspaceId, name);
    const { memberIds, leadId } = await this.resolveMembersAndLead(workspaceId, dto.memberIds ?? [], dto.leadId ?? null);
    const key = await this.uniqueKey(workspaceId, this.slugify(dto.key || name));
    const created = await this.prisma.team.create({
      data: {
        workspaceId, name, key,
        description: dto.description ?? null,
        color: dto.color ?? null,
        leadId,
        createdById: actingUserId,
        updatedById: actingUserId,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return this.get(workspaceId, created.id);
  }

  async update(workspaceId: string, teamId: string, dto: UpdateTeamInput, actingUserId: string) {
    const team = await this.requireTeam(workspaceId, teamId);
    const data: Prisma.TeamUpdateInput = { updatedById: actingUserId };

    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new ForbiddenAppException('Tên nhóm bắt buộc');
      await this.assertNameFree(workspaceId, name, teamId);
      data.name = name;
    }
    if (dto.key !== undefined && dto.key !== null) {
      data.key = await this.uniqueKey(workspaceId, this.slugify(dto.key || dto.name || team.name), teamId);
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;

    // Thành viên + lead: thay toàn bộ danh sách nếu memberIds gửi lên; đảm bảo lead luôn là thành viên.
    let replaceMembers: string[] | undefined;
    if (dto.memberIds !== undefined) replaceMembers = await this.validateWorkspaceMembers(workspaceId, dto.memberIds);

    if (dto.leadId !== undefined) {
      const leadId = dto.leadId || null;
      if (leadId) await this.validateWorkspaceMembers(workspaceId, [leadId]);
      data.lead = leadId ? { connect: { id: leadId } } : { disconnect: true };
      if (leadId) {
        if (replaceMembers && !replaceMembers.includes(leadId)) replaceMembers.push(leadId);
        else if (!replaceMembers) {
          await this.prisma.teamMember.upsert({
            where: { teamId_userId: { teamId, userId: leadId } },
            create: { teamId, userId: leadId }, update: {},
          });
        }
      }
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [this.prisma.team.update({ where: { id: teamId }, data })];
    if (replaceMembers !== undefined) {
      ops.push(this.prisma.teamMember.deleteMany({ where: { teamId } }));
      ops.push(this.prisma.teamMember.createMany({ data: replaceMembers.map((userId) => ({ teamId, userId })) }));
    }
    await this.prisma.$transaction(ops);
    return this.get(workspaceId, teamId);
  }

  async setMembers(workspaceId: string, teamId: string, memberIds: string[]) {
    await this.requireTeam(workspaceId, teamId);
    const ids = await this.validateWorkspaceMembers(workspaceId, memberIds);
    const cur = await this.prisma.team.findUnique({ where: { id: teamId }, select: { leadId: true } });
    if (cur?.leadId && !ids.includes(cur.leadId)) ids.push(cur.leadId); // giữ lead trong nhóm
    await this.prisma.$transaction([
      this.prisma.teamMember.deleteMany({ where: { teamId } }),
      this.prisma.teamMember.createMany({ data: ids.map((userId) => ({ teamId, userId })) }),
    ]);
    return this.get(workspaceId, teamId);
  }

  async remove(workspaceId: string, teamId: string) {
    await this.requireTeam(workspaceId, teamId);
    await this.prisma.team.delete({ where: { id: teamId } }); // Issue.teamId → null (FK), TeamMember cascade
    return { success: true };
  }

  /** Thêm CẢ nhóm vào một dự án: mỗi thành viên → project membership với vai trò đã chọn. */
  async assignToProject(workspaceId: string, teamId: string, projectId: string, roleIds: string[]) {
    await this.requireTeam(workspaceId, teamId);
    const teamMembers = await this.prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } });
    let added = 0;
    for (const m of teamMembers) {
      await this.members.addProject(workspaceId, projectId, m.userId, roleIds); // validate project∈ws, existing→setRoles, rbac invalidate
      added++;
    }
    return { success: true, added };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async requireTeam(workspaceId: string, teamId: string) {
    const t = await this.prisma.team.findFirst({ where: { id: teamId, workspaceId, deletedAt: null }, select: { id: true, key: true, name: true } });
    if (!t) throw new NotFoundAppException('Nhóm');
    return t;
  }

  private async assertNameFree(workspaceId: string, name: string, excludeId?: string) {
    const clash = await this.prisma.team.findFirst({
      where: { workspaceId, name, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ForbiddenAppException('Tên nhóm đã tồn tại');
  }

  /** Các userId phải là thành viên workspace. Trả danh sách unique giữ thứ tự. */
  private async validateWorkspaceMembers(workspaceId: string, userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, userId: { in: unique } },
      select: { userId: true },
    });
    if (rows.length !== unique.length) throw new ForbiddenAppException('Một số người dùng không thuộc workspace này');
    return unique;
  }

  private async resolveMembersAndLead(workspaceId: string, memberIds: string[], leadId: string | null) {
    const ids = await this.validateWorkspaceMembers(workspaceId, memberIds);
    let lead: string | null = null;
    if (leadId) {
      await this.validateWorkspaceMembers(workspaceId, [leadId]);
      lead = leadId;
      if (!ids.includes(leadId)) ids.push(leadId); // lead luôn thuộc nhóm
    }
    return { memberIds: ids, leadId: lead };
  }

  private slugify(s: string): string {
    const base = s
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'd')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 30);
    return base || 'team';
  }

  private async uniqueKey(workspaceId: string, base: string, excludeId?: string): Promise<string> {
    let key = base;
    let n = 1;
    // Unique index (workspaceId,key) không lọc deletedAt; nhưng ta hard-delete nên chỉ cần né các nhóm còn sống.
    for (;;) {
      const clash = await this.prisma.team.findFirst({
        where: { workspaceId, key, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return key;
      n += 1;
      const suffix = `-${n}`;
      key = `${base.slice(0, 30 - suffix.length)}${suffix}`;
    }
  }

  private toUserDto(u: UserRow) {
    return {
      id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, timezone: u.timezone,
      locale: u.locale, status: u.status, isSystemAdmin: u.isSystemAdmin,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
    };
  }

  private toTeamDto(t: {
    id: string; workspaceId: string; name: string; key: string; description: string | null; color: string | null;
    createdAt: Date; lead: UserRow | null; members: { user: UserRow }[]; _count: { members: number };
  }) {
    return {
      id: t.id,
      workspaceId: t.workspaceId,
      name: t.name,
      key: t.key,
      description: t.description,
      color: t.color,
      lead: t.lead ? this.toUserDto(t.lead) : null,
      members: t.members.map((m) => this.toUserDto(m.user)),
      memberCount: t._count.members,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
