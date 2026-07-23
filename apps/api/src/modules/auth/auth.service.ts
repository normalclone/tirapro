import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createId } from '@paralleldrive/cuid2';
import { SYSTEM_ROLES, type PermissionKey } from '@tirapro/types';
import type { LoginInput, RegisterInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { RbacService } from '../rbac/rbac.service';
import { WorkspaceBootstrapService } from '../workspaces/workspace-bootstrap.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { TokenService, type RefreshMeta } from './token.service';
import type { InviteMemberInput } from './auth.schemas';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly bootstrap: WorkspaceBootstrapService,
    private readonly settings: SystemSettingsService,
  ) {}

  async register(input: RegisterInput, meta: RefreshMeta) {
    if (!this.settings.flags().signupEnabled) {
      throw new ForbiddenAppException('Đăng ký công khai đang tắt. Liên hệ admin hệ thống để được cấp tài khoản.');
    }
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email đã được đăng ký' });

    const passwordHash = await argon2.hash(input.password);
    const wsName = input.workspaceName?.trim() || `${input.displayName} Workspace`;

    const { user, workspaceId } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, displayName: input.displayName },
      });
      const slug = await this.uniqueSlug(tx, wsName);
      const ws = await tx.workspace.create({
        data: { name: wsName, slug, ownerId: user.id, plan: 'FREE', createdById: user.id },
      });
      await this.bootstrap.bootstrap(tx, ws.id);
      const adminRole = await tx.role.findFirst({
        where: { name: SYSTEM_ROLES.WORKSPACE_ADMIN, scope: 'WORKSPACE', workspaceId: null, isSystem: true },
        select: { id: true },
      });
      if (!adminRole) throw new Error('System role chưa được seed (chạy pnpm db:seed)');
      await tx.workspaceMembership.create({
        data: { workspaceId: ws.id, userId: user.id, roleId: adminRole.id, joinedAt: new Date() },
      });
      return { user, workspaceId: ws.id };
    });

    return this.issueSession(user, workspaceId, meta);
  }

  async login(input: LoginInput, meta: RefreshMeta) {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.status === 'DEACTIVATED') {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng' });
    }
    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng' });

    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
    return this.issueSession(user, membership?.workspaceId ?? null, meta);
  }

  async refresh(refreshToken: string, meta: RefreshMeta) {
    const { userId, newToken } = await this.tokens.rotateRefresh(refreshToken, meta);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    });
    const access = this.tokens.signAccess(user, membership?.workspaceId ?? null);
    return { ...access, refreshToken: newToken, user: this.publicUser(user) };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) await this.tokens.revokeFamilyByToken(refreshToken);
    return { success: true };
  }

  async me(userId: string, workspaceId: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const roleRefSelect = { role: { select: { id: true, name: true, color: true } } };
    const wsMemberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      select: { id: true, workspaceId: true, roleId: true, role: { select: { name: true, scope: true } }, roles: { select: roleRefSelect } },
    });
    const projMemberships = await this.prisma.projectMembership.findMany({
      where: { userId },
      select: { id: true, projectId: true, project: { select: { workspaceId: true } }, roleId: true, role: { select: { name: true, scope: true } }, roles: { select: roleRefSelect } },
    });
    const permissions: PermissionKey[] = workspaceId
      ? ([...(await this.rbac.getEffectivePermissions(userId, workspaceId))] as PermissionKey[])
      : [];
    // Gộp vai trò chính + phụ (dedupe theo id), giữ roleName là vai trò chính.
    const rolesOf = (primary: { roleId: string; role: { name: string } }, extra: { role: { id: string; name: string; color: string | null } }[]) => {
      const map = new Map<string, { id: string; name: string; color: string | null }>();
      for (const e of extra) map.set(e.role.id, e.role);
      if (!map.has(primary.roleId)) map.set(primary.roleId, { id: primary.roleId, name: primary.role.name, color: null });
      return [...map.values()];
    };
    return {
      user: this.publicUser(user),
      workspaceId,
      memberships: [
        ...wsMemberships.map((m) => ({
          id: m.id, workspaceId: m.workspaceId, userId, roleId: m.roleId, roleName: m.role.name,
          roles: rolesOf(m, m.roles), scope: m.role.scope, projectId: null,
        })),
        ...projMemberships.map((m) => ({
          id: m.id, workspaceId: m.project.workspaceId, userId, roleId: m.roleId, roleName: m.role.name,
          roles: rolesOf(m, m.roles), scope: m.role.scope, projectId: m.projectId,
        })),
      ],
      permissions,
    };
  }

  /** Danh sách workspace mà user là thành viên (kèm role). */
  async listWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        workspace: { select: { id: true, name: true, slug: true, avatarUrl: true } },
        role: { select: { name: true } },
      },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      avatarUrl: m.workspace.avatarUrl,
      roleName: m.role.name,
    }));
  }

  /**
   * Chuyển workspace: xác minh user là thành viên của workspace đích, rồi cấp
   * session mới (access token mang workspaceId mới + xoay refresh) — y hệt login.
   */
  async switchWorkspace(userId: string, workspaceId: string, meta: RefreshMeta) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenAppException('Bạn không phải thành viên của workspace này');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.issueSession(user, workspaceId, meta);
  }

  /**
   * Mời thành viên vào workspace hiện tại. Tạo User mới nếu email chưa tồn tại
   * (mật khẩu tạm ngẫu nhiên, hash argon2). Idempotent: đã là thành viên thì trả về luôn.
   */
  async invite(
    currentWorkspaceId: string | null,
    input: InviteMemberInput,
  ): Promise<{ userId: string; email: string; invited: true; tempPassword?: string }> {
    if (!currentWorkspaceId) throw new ForbiddenAppException('Chưa chọn workspace');

    const email = input.email.toLowerCase();
    const requested = input.roleIds ?? (input.roleId ? [input.roleId] : []);
    const roleIds = await this.resolveInviteRoleIds(currentWorkspaceId, requested);

    let tempPassword: string | undefined;
    let userId: string;

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      userId = existing.id;
    } else {
      // Mật khẩu tạm ngẫu nhiên để admin chuyển cho thành viên (TODO: gửi email thật).
      tempPassword = createId();
      const passwordHash = await argon2.hash(tempPassword);
      const created = await this.prisma.user.create({
        data: { email, displayName: input.displayName, passwordHash },
        select: { id: true },
      });
      userId = created.id;
    }

    // Idempotent: nếu đã là thành viên thì trả về membership hiện có, không báo lỗi.
    const member = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: currentWorkspaceId, userId } },
      select: { id: true },
    });
    if (!member) {
      await this.prisma.workspaceMembership.create({
        data: {
          workspaceId: currentWorkspaceId, userId, roleId: roleIds[0]!, joinedAt: new Date(),
          roles: { create: roleIds.map((rid) => ({ roleId: rid })) },
        },
      });
    }

    return tempPassword
      ? { userId, email, invited: true, tempPassword }
      : { userId, email, invited: true };
  }

  /**
   * Chuẩn hoá danh sách roleId cho lời mời: mỗi role phải hợp lệ (thuộc workspace
   * hoặc system role). Rỗng → mặc định [Workspace Member]. Trả về mảng đã khử trùng.
   */
  private async resolveInviteRoleIds(workspaceId: string, roleIds: string[]): Promise<string[]> {
    const unique = [...new Set(roleIds)];
    if (unique.length) {
      const found = await this.prisma.role.findMany({
        where: { id: { in: unique }, OR: [{ workspaceId }, { workspaceId: null }] },
        select: { id: true },
      });
      if (found.length !== unique.length) throw new NotFoundAppException('Vai trò');
      return found.map((r) => r.id);
    }
    const memberRole = await this.prisma.role.findFirst({
      where: { name: SYSTEM_ROLES.WORKSPACE_MEMBER, scope: 'WORKSPACE', workspaceId: null, isSystem: true },
      select: { id: true },
    });
    if (!memberRole) throw new Error('System role chưa được seed (chạy pnpm db:seed)');
    return [memberRole.id];
  }

  private async issueSession(
    user: { id: string; email: string },
    workspaceId: string | null,
    meta: RefreshMeta,
  ) {
    const access = this.tokens.signAccess(user, workspaceId);
    const refreshToken = await this.tokens.issueRefresh(user.id, null, meta);
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { ...access, refreshToken, user: this.publicUser(full) };
  }

  private publicUser(u: {
    id: string; email: string; displayName: string; avatarUrl: string | null;
    timezone: string; locale: string; status: string; isSystemAdmin: boolean;
    lastSeenAt: Date | null; createdAt: Date;
  }) {
    return {
      id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl,
      timezone: u.timezone, locale: u.locale, status: u.status, isSystemAdmin: u.isSystemAdmin,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
    };
  }

  private async uniqueSlug(tx: { workspace: { findUnique: (a: any) => Promise<unknown> } }, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace';
    let slug = base;
    let i = 1;
    while (await tx.workspace.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
      if (i > 50) { slug = `${base}-${createId().slice(0, 6)}`; break; }
    }
    return slug;
  }
}
