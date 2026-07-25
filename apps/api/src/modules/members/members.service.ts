import { Injectable } from '@nestjs/common';
import { DEFAULT_PROJECT_ROLE_BY_WS_ROLE, type RoleScope } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { RbacService } from '../rbac/rbac.service';

const USER_SELECT = {
  id: true, email: true, displayName: true, avatarUrl: true, timezone: true,
  locale: true, status: true, isSystemAdmin: true, lastSeenAt: true, createdAt: true,
} as const;

type UserRow = {
  id: string; email: string; displayName: string; avatarUrl: string | null; timezone: string;
  locale: string; status: string; isSystemAdmin: boolean; lastSeenAt: Date | null; createdAt: Date;
};
type RoleRefRow = { role: { id: string; name: string; color: string | null } };

/**
 * Quản lý thành viên + GÁN NHIỀU VAI TRÒ ở cấp workspace và project.
 * roleId trên membership = vai trò chính (= roleIds[0]); join table giữ toàn bộ.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  // ───────────────────────── Workspace ─────────────────────────

  async listWorkspace(workspaceId: string) {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, joinedAt: true, user: { select: USER_SELECT }, roles: { select: { role: { select: { id: true, name: true, color: true } } } } },
    });
    return rows.map((m) => this.toMemberDto(m));
  }

  async addWorkspace(workspaceId: string, userId: string, roleIds: string[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundAppException('Người dùng');
    const existing = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (existing) return this.setWorkspaceRoles(workspaceId, userId, roleIds); // đã là thành viên → cập nhật vai trò
    const ids = await this.validateRoles(workspaceId, roleIds, 'WORKSPACE');
    await this.prisma.workspaceMembership.create({
      data: {
        workspaceId, userId, roleId: ids[0]!, joinedAt: new Date(),
        roles: { create: ids.map((roleId) => ({ roleId })) },
      },
    });
    await this.rbac.invalidate(userId, workspaceId);
    return this.getWorkspaceMember(workspaceId, userId);
  }

  async setWorkspaceRoles(workspaceId: string, userId: string, roleIds: string[]) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundAppException('Thành viên');
    const ids = await this.validateRoles(workspaceId, roleIds, 'WORKSPACE');
    await this.prisma.$transaction([
      this.prisma.workspaceMembershipRole.deleteMany({ where: { membershipId: membership.id } }),
      this.prisma.workspaceMembershipRole.createMany({ data: ids.map((roleId) => ({ membershipId: membership.id, roleId })) }),
      this.prisma.workspaceMembership.update({ where: { id: membership.id }, data: { roleId: ids[0]! } }),
    ]);
    await this.rbac.invalidate(userId, workspaceId);
    return this.getWorkspaceMember(workspaceId, userId);
  }

  /** Thêm NHIỀU người vào workspace cùng bộ vai trò; bỏ qua người đã là thành viên. */
  async addWorkspaceMany(workspaceId: string, userIds: string[], roleIds: string[]) {
    const ids = await this.validateRoles(workspaceId, roleIds, 'WORKSPACE');
    const unique = [...new Set(userIds)];
    const existUsers = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true } });
    const valid = new Set(existUsers.map((u) => u.id));
    const already = await this.prisma.workspaceMembership.findMany({ where: { workspaceId, userId: { in: [...valid] } }, select: { userId: true } });
    const alreadySet = new Set(already.map((a) => a.userId));
    const toAdd = [...valid].filter((u) => !alreadySet.has(u));
    for (const userId of toAdd) {
      await this.prisma.workspaceMembership.create({
        data: { workspaceId, userId, roleId: ids[0]!, joinedAt: new Date(), roles: { create: ids.map((roleId) => ({ roleId })) } },
      });
      await this.rbac.invalidate(userId, workspaceId);
    }
    return { added: toAdd.length, skipped: unique.length - toAdd.length };
  }

  async removeWorkspace(workspaceId: string, userId: string, actingUserId: string) {
    if (userId === actingUserId) throw new ForbiddenAppException('Không thể tự gỡ chính mình');
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } });
    if (ws?.ownerId === userId) throw new ForbiddenAppException('Không thể gỡ chủ sở hữu workspace');
    await this.prisma.workspaceMembership.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
    await this.rbac.invalidate(userId, workspaceId);
    return { success: true };
  }

  // ───────────────────────── Project ─────────────────────────

  /** Dự án PHẢI thuộc workspace của người gọi (chống truy cập chéo tenant). Trả về khi hợp lệ. */
  private async requireProject(workspaceId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
  }

  /**
   * Thành viên DỰ ÁN = TOÀN BỘ thành viên workspace (dự án dùng chung tập người dùng).
   * Vai trò hiển thị là vai trò HIỆU LỰC: ghi đè riêng ở dự án nếu có, ngược lại là
   * vai trò mặc định suy từ vai trò workspace (`DEFAULT_PROJECT_ROLE_BY_WS_ROLE`).
   */
  async listProject(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const [wsRows, overrides, projectRoles] = await Promise.all([
      this.prisma.workspaceMembership.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, joinedAt: true, user: { select: USER_SELECT }, roles: { select: { role: { select: { id: true, name: true, color: true } } } } },
      }),
      this.prisma.projectMembership.findMany({
        where: { projectId },
        select: { id: true, userId: true, roles: { select: { role: { select: { id: true, name: true, color: true } } } } },
      }),
      this.prisma.role.findMany({
        where: { scope: 'PROJECT', OR: [{ workspaceId }, { workspaceId: null }] },
        select: { id: true, name: true, color: true },
      }),
    ]);
    const overrideByUser = new Map(overrides.map((o) => [o.userId, o]));
    const projRoleByName = new Map(projectRoles.map((r) => [r.name, r]));

    return wsRows.map((m) => {
      const ov = overrideByUser.get(m.user.id);
      if (ov) {
        return { ...this.toMemberDto({ id: ov.id, user: m.user, roles: ov.roles }), isOverride: true };
      }
      // Vai trò mặc định theo vai trò workspace của người này.
      const defaults: { id: string; name: string; color: string | null }[] = [];
      for (const r of m.roles) {
        const target = DEFAULT_PROJECT_ROLE_BY_WS_ROLE[r.role.name];
        const found = target ? projRoleByName.get(target) : undefined;
        if (found && !defaults.some((d) => d.id === found.id)) defaults.push(found);
      }
      return {
        membershipId: m.id,
        user: this.toUserDto(m.user),
        roles: defaults,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        isOverride: false,
      };
    });
  }

  /** Xoá GHI ĐÈ vai trò ở dự án → người này quay về vai trò mặc định của workspace. */
  async clearProjectOverride(workspaceId: string, projectId: string, userId: string) {
    await this.requireProject(workspaceId, projectId);
    await this.prisma.projectMembership.deleteMany({ where: { projectId, userId } });
    await this.rbac.invalidate(userId, workspaceId);
    return { success: true };
  }

  async addProject(workspaceId: string, projectId: string, userId: string, roleIds: string[]) {
    await this.requireProject(workspaceId, projectId);
    // Người được thêm phải là thành viên workspace của dự án.
    const isMember = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!isMember) throw new ForbiddenAppException('Người dùng chưa thuộc workspace này');

    const ids = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
    const existing = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    if (existing) return this.setProjectRoles(workspaceId, projectId, userId, roleIds);

    await this.prisma.projectMembership.create({
      data: { projectId, userId, roleId: ids[0]!, roles: { create: ids.map((roleId) => ({ roleId })) } },
    });
    await this.rbac.invalidate(userId, workspaceId);
    return this.getProjectMember(projectId, userId);
  }

  async setProjectRoles(workspaceId: string, projectId: string, userId: string, roleIds: string[]) {
    await this.requireProject(workspaceId, projectId);
    const membership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    // Chưa có ghi đè → TẠO MỚI (mọi thành viên workspace đều thuộc dự án theo mặc định,
    // đặt vai trò riêng ở đây chính là tạo bản ghi đè).
    if (!membership) return this.addProject(workspaceId, projectId, userId, roleIds);
    const ids = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
    await this.prisma.$transaction([
      this.prisma.projectMembershipRole.deleteMany({ where: { membershipId: membership.id } }),
      this.prisma.projectMembershipRole.createMany({ data: ids.map((roleId) => ({ membershipId: membership.id, roleId })) }),
      this.prisma.projectMembership.update({ where: { id: membership.id }, data: { roleId: ids[0]! } }),
    ]);
    await this.rbac.invalidate(userId, workspaceId);
    return this.getProjectMember(projectId, userId);
  }

  /** Thêm NHIỀU người vào dự án cùng bộ vai trò; chỉ nhận người ĐÃ thuộc workspace, bỏ qua người đã ở dự án. */
  async addProjectMany(workspaceId: string, projectId: string, userIds: string[], roleIds: string[]) {
    await this.requireProject(workspaceId, projectId);
    const ids = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
    const unique = [...new Set(userIds)];
    const wsMembers = await this.prisma.workspaceMembership.findMany({ where: { workspaceId, userId: { in: unique } }, select: { userId: true } });
    const wsSet = new Set(wsMembers.map((m) => m.userId));
    const valid = unique.filter((u) => wsSet.has(u));
    const already = await this.prisma.projectMembership.findMany({ where: { projectId, userId: { in: valid } }, select: { userId: true } });
    const alreadySet = new Set(already.map((a) => a.userId));
    const toAdd = valid.filter((u) => !alreadySet.has(u));
    for (const userId of toAdd) {
      await this.prisma.projectMembership.create({
        data: { projectId, userId, roleId: ids[0]!, roles: { create: ids.map((roleId) => ({ roleId })) } },
      });
      await this.rbac.invalidate(userId, workspaceId);
    }
    return { added: toAdd.length, skipped: unique.length - toAdd.length };
  }


  // ───────────────────────── helpers ─────────────────────────

  private async getWorkspaceMember(workspaceId: string, userId: string) {
    const m = await this.prisma.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true, joinedAt: true, user: { select: USER_SELECT }, roles: { select: { role: { select: { id: true, name: true, color: true } } } } },
    });
    return this.toMemberDto(m);
  }

  private async getProjectMember(projectId: string, userId: string) {
    const m = await this.prisma.projectMembership.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true, user: { select: USER_SELECT }, roles: { select: { role: { select: { id: true, name: true, color: true } } } } },
    });
    return this.toMemberDto(m);
  }

  /** Mỗi role phải tồn tại (system hoặc của workspace) và đúng scope của cấp đang gán. */
  private async validateRoles(workspaceId: string, roleIds: string[], scope: RoleScope): Promise<string[]> {
    const unique = [...new Set(roleIds)];
    const found = await this.prisma.role.findMany({
      where: { id: { in: unique }, scope, OR: [{ workspaceId }, { workspaceId: null }] },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new ForbiddenAppException(`Một số vai trò không hợp lệ cho cấp ${scope === 'PROJECT' ? 'dự án' : 'workspace'}`);
    }
    // Giữ thứ tự gốc (roleIds[0] = vai trò chính).
    const set = new Set(found.map((r) => r.id));
    return unique.filter((id) => set.has(id));
  }

  private toUserDto(u: UserRow) {
    return {
      id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, timezone: u.timezone,
      locale: u.locale, status: u.status, isSystemAdmin: u.isSystemAdmin,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
    };
  }

  private toMemberDto(m: { id: string; joinedAt?: Date | null; user: UserRow; roles: RoleRefRow[] }) {
    return {
      membershipId: m.id,
      user: this.toUserDto(m.user),
      roles: m.roles.map((r) => ({ id: r.role.id, name: r.role.name, color: r.role.color })),
      joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
    };
  }
}
