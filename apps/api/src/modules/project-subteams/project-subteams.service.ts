import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, type ProjectSubTeamDto } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';
import { assertNotArchived } from '../../common/project-writable';
import { AuditService } from '../audit/audit.service';
import { lockProjectSubTeams } from './subteam-membership';
import type {
  CreateProjectSubTeamInput,
  UpdateProjectSubTeamInput,
} from './project-subteams.schemas';

type Tx = Prisma.TransactionClient;

const SUBTEAM_SELECT = {
  id: true,
  projectId: true,
  name: true,
  color: true,
  createdAt: true,
  members: {
    select: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
  },
} satisfies Prisma.ProjectSubTeamSelect;

type Row = Prisma.ProjectSubTeamGetPayload<{ select: typeof SUBTEAM_SELECT }>;

const TX_OPTS = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * Team RIÊNG trong dự án: nhóm người để lọc/nhóm board, báo cáo và JQL `team` — KHÔNG cấp quyền. Thành viên phải là thành viên dự án
 * (công khai = mọi thành viên tổ chức đang hoạt động; riêng tư = chỉ người có `ProjectMembership`), một người vào được nhiều team.
 * Người rời dự án thì ra khỏi team (xem `subteam-membership.ts`). Tên duy nhất trong dự án, không phân biệt hoa/thường.
 */
@Injectable()
export class ProjectSubTeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, projectId: string): Promise<ProjectSubTeamDto[]> {
    await this.requireProject(organizationId, projectId);
    const rows = await this.prisma.projectSubTeam.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
      select: SUBTEAM_SELECT,
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    organizationId: string,
    projectId: string,
    dto: CreateProjectSubTeamInput,
    actorId: string,
  ): Promise<ProjectSubTeamDto> {
    const project = await this.requireProject(organizationId, projectId);
    assertNotArchived(project.archivedAt);
    const name = this.cleanName(dto.name);
    const id = await this.prisma.$transaction(async (tx) => {
      await lockProjectSubTeams(tx, projectId);
      await this.assertNameFree(tx, projectId, name);
      const members = await this.eligibleMembers(tx, organizationId, project, dto.memberIds ?? []);
      const created = await tx.projectSubTeam.create({
        data: {
          projectId,
          name,
          color: dto.color ?? null,
          createdById: actorId,
          members: { create: members.map((userId) => ({ userId })) },
        },
        select: { id: true },
      });
      return created.id;
    }, TX_OPTS);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_SUBTEAM_CREATED,
      entityType: 'project',
      entityId: projectId,
      summary: `Tạo team "${name}" trong dự án "${project.name}"`,
      meta: { projectId, subTeamId: id },
    });
    return this.get(projectId, id);
  }

  async update(
    organizationId: string,
    projectId: string,
    subTeamId: string,
    dto: UpdateProjectSubTeamInput,
    actorId: string,
  ): Promise<ProjectSubTeamDto> {
    const project = await this.requireProject(organizationId, projectId);
    assertNotArchived(project.archivedAt);
    const name = dto.name === undefined ? undefined : this.cleanName(dto.name);
    const before = await this.prisma.$transaction(async (tx) => {
      await lockProjectSubTeams(tx, projectId);
      const cur = await tx.projectSubTeam.findFirst({
        where: { id: subTeamId, projectId },
        select: { name: true },
      });
      if (!cur) throw new NotFoundAppException('Team');
      if (name !== undefined && name.toLowerCase() !== cur.name.toLowerCase())
        await this.assertNameFree(tx, projectId, name, subTeamId);
      await tx.projectSubTeam.update({
        where: { id: subTeamId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
      });
      if (dto.memberIds !== undefined)
        await this.replaceMembers(tx, organizationId, project, subTeamId, dto.memberIds);
      return cur.name;
    }, TX_OPTS);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_SUBTEAM_UPDATED,
      entityType: 'project',
      entityId: projectId,
      summary: `Sửa team "${before}" trong dự án "${project.name}"${name && name !== before ? ` (đổi tên thành "${name}")` : ''}`,
      meta: { projectId, subTeamId, membersChanged: dto.memberIds !== undefined },
    });
    return this.get(projectId, subTeamId);
  }

  async setMembers(
    organizationId: string,
    projectId: string,
    subTeamId: string,
    memberIds: string[],
    actorId: string,
  ): Promise<ProjectSubTeamDto> {
    return this.update(organizationId, projectId, subTeamId, { memberIds }, actorId);
  }

  async remove(
    organizationId: string,
    projectId: string,
    subTeamId: string,
    actorId: string,
  ): Promise<{ success: true }> {
    const project = await this.requireProject(organizationId, projectId);
    assertNotArchived(project.archivedAt);
    const team = await this.prisma.projectSubTeam.findFirst({
      where: { id: subTeamId, projectId },
      select: { name: true },
    });
    if (!team) throw new NotFoundAppException('Team');
    await this.prisma.projectSubTeam.delete({ where: { id: subTeamId } }); // thành viên cascade
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_SUBTEAM_DELETED,
      entityType: 'project',
      entityId: projectId,
      summary: `Xoá team "${team.name}" khỏi dự án "${project.name}"`,
      meta: { projectId, subTeamId },
    });
    return { success: true };
  }

  // ───────────────────────── nội bộ ─────────────────────────

  private async get(projectId: string, subTeamId: string): Promise<ProjectSubTeamDto> {
    const row = await this.prisma.projectSubTeam.findFirst({
      where: { id: subTeamId, projectId },
      select: SUBTEAM_SELECT,
    });
    if (!row) throw new NotFoundAppException('Team');
    return this.toDto(row);
  }

  private async requireProject(organizationId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true, name: true, isPrivate: true, archivedAt: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  private cleanName(raw: string): string {
    const name = raw.trim();
    if (!name) throw new BusinessRuleException('Tên team bắt buộc');
    return name;
  }

  private async assertNameFree(tx: Tx, projectId: string, name: string, exceptId?: string) {
    const dup = await tx.projectSubTeam.findFirst({
      where: {
        projectId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (dup) throw new BusinessRuleException(`Dự án đã có team tên "${name}" — hãy chọn tên khác`);
  }

  /**
   * Người được phép vào team: thành viên tổ chức đang hoạt động (không phải người dùng hệ thống) VÀ — dự án riêng tư — có `ProjectMembership`.
   * Có người không đủ điều kiện → lỗi rõ ràng (không bỏ qua im lặng, để UI báo).
   */
  private async eligibleMembers(
    tx: Tx,
    organizationId: string,
    project: { id: string; isPrivate: boolean },
    userIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const ok = await tx.user.findMany({
      where: {
        id: { in: unique },
        status: { not: 'DEACTIVATED' },
        email: { not: SYSTEM_USER_EMAIL },
        organizationMemberships: { some: { organizationId } },
        ...(project.isPrivate ? { projectMemberships: { some: { projectId: project.id } } } : {}),
      },
      select: { id: true },
    });
    if (ok.length !== unique.length)
      throw new BusinessRuleException(
        'Chỉ thành viên của dự án mới vào được team — hãy thêm họ vào dự án trước',
      );
    return unique;
  }

  /** Thay TOÀN BỘ thành viên: chỉ xoá người bị bỏ và thêm người mới (người ở lại không đổi). */
  private async replaceMembers(
    tx: Tx,
    organizationId: string,
    project: { id: string; isPrivate: boolean },
    subTeamId: string,
    memberIds: string[],
  ): Promise<void> {
    const want = await this.eligibleMembers(tx, organizationId, project, memberIds);
    await tx.projectSubTeamMember.deleteMany({ where: { subTeamId, userId: { notIn: want } } });
    await tx.projectSubTeamMember.createMany({
      data: want.map((userId) => ({ subTeamId, userId })),
      skipDuplicates: true,
    });
  }

  private toDto(r: Row): ProjectSubTeamDto {
    const members = r.members
      .map((m) => m.user)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
    return {
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      color: r.color,
      members,
      memberCount: members.length,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
