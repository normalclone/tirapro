import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toUserDto, USER_DTO_SELECT, type UserDtoSource } from '../../common/mappers/user.mapper';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { MembersService } from '../members/members.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import type { CreateTeamInput, UpdateTeamInput } from './teams.schemas';

const TEAM_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  key: true,
  description: true,
  color: true,
  createdAt: true,
  lead: { select: USER_DTO_SELECT },
  members: {
    orderBy: { createdAt: 'asc' as const },
    select: { user: { select: USER_DTO_SELECT } },
  },
  _count: { select: { members: true } },
} satisfies Prisma.TeamSelect;

/**
 * Nhóm (team) — nhóm thành viên trong tổ chức, dùng lại khắp dự án & issue.
 * Xoá nhóm = hard delete: Issue.teamId tự về null (FK SET NULL), TeamMember cascade.
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(organizationId: string) {
    const rows = await this.prisma.team.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: TEAM_SELECT,
    });
    return rows.map((t) => this.toTeamDto(t));
  }

  async get(organizationId: string, teamId: string) {
    const t = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
      select: TEAM_SELECT,
    });
    if (!t) throw new NotFoundAppException('Nhóm');
    return this.toTeamDto(t);
  }

  async create(organizationId: string, dto: CreateTeamInput, actingUserId: string) {
    const name = dto.name.trim();
    if (!name) throw new ForbiddenAppException('Tên nhóm bắt buộc');
    await this.assertNameFree(organizationId, name);
    const { memberIds, leadId } = await this.resolveMembersAndLead(
      organizationId,
      dto.memberIds ?? [],
      dto.leadId ?? null,
    );
    const key = await this.uniqueKey(organizationId, this.slugify(dto.key || name));
    const created = await this.prisma.team.create({
      data: {
        organizationId,
        name,
        key,
        description: dto.description ?? null,
        color: dto.color ?? null,
        leadId,
        createdById: actingUserId,
        updatedById: actingUserId,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return this.get(organizationId, created.id);
  }

  async update(organizationId: string, teamId: string, dto: UpdateTeamInput, actingUserId: string) {
    const team = await this.requireTeam(organizationId, teamId);
    const data: Prisma.TeamUpdateInput = { updatedById: actingUserId };

    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new ForbiddenAppException('Tên nhóm bắt buộc');
      await this.assertNameFree(organizationId, name, teamId);
      data.name = name;
    }
    if (dto.key !== undefined && dto.key !== null) {
      data.key = await this.uniqueKey(
        organizationId,
        this.slugify(dto.key || dto.name || team.name),
        teamId,
      );
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;

    // Thành viên + lead: thay toàn bộ danh sách nếu memberIds gửi lên; đảm bảo lead luôn là thành viên.
    let replaceMembers: string[] | undefined;
    if (dto.memberIds !== undefined)
      replaceMembers = await this.validateOrganizationMembers(organizationId, dto.memberIds);

    if (dto.leadId !== undefined) {
      const leadId = dto.leadId || null;
      if (leadId) await this.validateOrganizationMembers(organizationId, [leadId]);
      data.lead = leadId ? { connect: { id: leadId } } : { disconnect: true };
      if (leadId) {
        if (replaceMembers && !replaceMembers.includes(leadId)) replaceMembers.push(leadId);
        else if (!replaceMembers) {
          await this.prisma.teamMember.upsert({
            where: { teamId_userId: { teamId, userId: leadId } },
            create: { teamId, userId: leadId },
            update: {},
          });
        }
      }
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.team.update({ where: { id: teamId }, data }),
    ];
    if (replaceMembers !== undefined) {
      ops.push(this.prisma.teamMember.deleteMany({ where: { teamId } }));
      ops.push(
        this.prisma.teamMember.createMany({
          data: replaceMembers.map((userId) => ({ teamId, userId })),
        }),
      );
    }
    await this.prisma.$transaction(ops);
    return this.get(organizationId, teamId);
  }

  async setMembers(organizationId: string, teamId: string, memberIds: string[]) {
    await this.requireTeam(organizationId, teamId);
    const ids = await this.validateOrganizationMembers(organizationId, memberIds);
    const cur = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { leadId: true },
    });
    if (cur?.leadId && !ids.includes(cur.leadId)) ids.push(cur.leadId); // giữ lead trong nhóm
    await this.prisma.$transaction([
      this.prisma.teamMember.deleteMany({ where: { teamId } }),
      this.prisma.teamMember.createMany({ data: ids.map((userId) => ({ teamId, userId })) }),
    ]);
    return this.get(organizationId, teamId);
  }

  async remove(organizationId: string, teamId: string) {
    await this.requireTeam(organizationId, teamId);
    await this.prisma.team.delete({ where: { id: teamId } }); // Issue.teamId → null (FK), TeamMember cascade
    return { success: true };
  }

  /** Thêm CẢ nhóm vào một dự án: mỗi thành viên → project membership với vai trò đã chọn. */
  async assignToProject(
    organizationId: string,
    teamId: string,
    projectId: string,
    roleIds: string[],
    actorId: string | null,
  ) {
    await this.requireTeam(organizationId, teamId);
    // Route không có `@ProjectRef` (projectId nằm ở body, route có :id) nên guard không kiểm dự án: người gọi không thấy
    // dự án riêng tư thì 404 như dự án không tồn tại (không thêm được ai, không lộ sự tồn tại).
    if (actorId) await this.access.assertCanSee(actorId, organizationId, projectId, 'Dự án');
    const teamMembers = await this.prisma.teamMember.findMany({
      // Bỏ qua tài khoản đã vô hiệu hoá — không đặt vai trò dự án cho họ (và không làm hỏng cả lượt giao nhóm).
      where: { teamId, user: { status: { not: 'DEACTIVATED' } } },
      select: { userId: true },
    });
    let added = 0;
    for (const m of teamMembers) {
      await this.members.addProject(
        organizationId,
        projectId,
        m.userId,
        roleIds,
        actorId ?? undefined,
      ); // validate project∈ws, existing→setRoles, rbac invalidate
      added++;
    }
    return { success: true, added };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async requireTeam(organizationId: string, teamId: string) {
    const t = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
      select: { id: true, key: true, name: true },
    });
    if (!t) throw new NotFoundAppException('Nhóm');
    return t;
  }

  private async assertNameFree(organizationId: string, name: string, excludeId?: string) {
    const clash = await this.prisma.team.findFirst({
      where: {
        organizationId,
        name,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ForbiddenAppException('Tên nhóm đã tồn tại');
  }

  /** Các userId phải là thành viên organization. Trả danh sách unique giữ thứ tự. */
  private async validateOrganizationMembers(
    organizationId: string,
    userIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId, userId: { in: unique } },
      select: { userId: true },
    });
    if (rows.length !== unique.length)
      throw new ForbiddenAppException(
        'Một số người dùng không thuộc tổ chức này — hãy chọn lại từ danh sách thành viên',
      );
    return unique;
  }

  private async resolveMembersAndLead(
    organizationId: string,
    memberIds: string[],
    leadId: string | null,
  ) {
    const ids = await this.validateOrganizationMembers(organizationId, memberIds);
    let lead: string | null = null;
    if (leadId) {
      await this.validateOrganizationMembers(organizationId, [leadId]);
      lead = leadId;
      if (!ids.includes(leadId)) ids.push(leadId); // lead luôn thuộc nhóm
    }
    return { memberIds: ids, leadId: lead };
  }

  private slugify(s: string): string {
    const base = s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
    return base || 'team';
  }

  private async uniqueKey(
    organizationId: string,
    base: string,
    excludeId?: string,
  ): Promise<string> {
    let key = base;
    let n = 1;
    // Unique index (organizationId,key) không lọc deletedAt; nhưng ta hard-delete nên chỉ cần né các nhóm còn sống.
    for (;;) {
      // allow-deleted: unique (organizationId,key) không lọc deletedAt nên phải né cả nhóm đã xoá mềm
      const clash = await this.prisma.team.findFirst({
        where: { organizationId, key, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return key;
      n += 1;
      const suffix = `-${n}`;
      key = `${base.slice(0, 30 - suffix.length)}${suffix}`;
    }
  }

  private toTeamDto(t: {
    id: string;
    organizationId: string;
    name: string;
    key: string;
    description: string | null;
    color: string | null;
    createdAt: Date;
    lead: UserDtoSource | null;
    members: { user: UserDtoSource }[];
    _count: { members: number };
  }) {
    return {
      id: t.id,
      organizationId: t.organizationId,
      name: t.name,
      key: t.key,
      description: t.description,
      color: t.color,
      lead: t.lead ? toUserDto(t.lead) : null,
      members: t.members.map((m) => toUserDto(m.user)),
      memberCount: t._count.members,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
