import { Injectable } from '@nestjs/common';
import type { RoleScope } from '@tirapro/types';
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

  async listProject(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.projectMembership.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, user: { select: USER_SELECT }, roles: { select: { role: { select: { id: true, name: true, color: true } } } } },
    });
    return rows.map((m) => this.toMemberDto(m));
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
    if (!membership) throw new NotFoundAppException('Thành viên dự án');
    const ids = await this.validateRoles(workspaceId, roleIds, 'PROJECT');
    await this.prisma.$transaction([
      this.prisma.projectMembershipRole.deleteMany({ where: { membershipId: membership.id } }),
      this.prisma.projectMembershipRole.createMany({ data: ids.map((roleId) => ({ membershipId: membership.id, roleId })) }),
      this.prisma.projectMembership.update({ where: { id: membership.id }, data: { roleId: ids[0]! } }),
    ]);
    await this.rbac.invalidate(userId, workspaceId);
    return this.getProjectMember(projectId, userId);
  }

  async removeProject(workspaceId: string, projectId: string, userId: string) {
    await this.requireProject(workspaceId, projectId);
    await this.prisma.projectMembership.delete({ where: { projectId_userId: { projectId, userId } } });
    await this.rbac.invalidate(userId, workspaceId);
    return { success: true };
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
