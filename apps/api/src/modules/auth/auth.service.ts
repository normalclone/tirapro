import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createId } from '@paralleldrive/cuid2';
import { DOMAIN_EVENTS, SYSTEM_ROLES, type PermissionKey } from '@tirapro/types';
import type { LoginInput, RegisterInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { RbacService } from '../rbac/rbac.service';
import { SYSTEM_USER_EMAIL } from '../automation/rule-engine.service';
import { WorkspaceBootstrapService } from '../workspaces/workspace-bootstrap.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { TokenService, type RefreshMeta } from './token.service';

/** Giãn cách tối thiểu giữa hai lần ghi `lastSeenAt` khi refresh. */
const LAST_SEEN_THROTTLE_MS = 10 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly bootstrap: WorkspaceBootstrapService,
    private readonly settings: SystemSettingsService,
    private readonly events: EventEmitter2,
  ) {}

  async register(input: RegisterInput, meta: RefreshMeta) {
    if (!this.settings.flags().signupEnabled) {
      throw new ForbiddenAppException(
        'Đăng ký công khai đang tắt. Liên hệ admin hệ thống để được cấp tài khoản.',
      );
    }
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing)
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email đã được đăng ký' });

    const passwordHash = await argon2.hash(input.password);
    const wsName = input.workspaceName?.trim() || `Không gian của ${input.displayName}`;

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
        where: {
          name: SYSTEM_ROLES.WORKSPACE_ADMIN,
          scope: 'WORKSPACE',
          workspaceId: null,
          isSystem: true,
        },
        select: { id: true },
      });
      if (!adminRole) throw new Error('System role chưa được seed (chạy pnpm db:seed)');
      await tx.workspaceMembership.create({
        data: {
          workspaceId: ws.id,
          userId: user.id,
          roleId: adminRole.id,
          joinedAt: new Date(),
          // Bảng nối mới là nguồn sự thật cho UI (vai trò hiển thị, đếm thành viên) — ghi cùng cột roleId cũ.
          roles: { create: [{ roleId: adminRole.id }] },
        },
      });
      return { user, workspaceId: ws.id };
    });

    return this.issueSession(user, workspaceId, meta);
  }

  async login(input: LoginInput, meta: RefreshMeta) {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.status === 'DEACTIVATED') {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng',
      });
    }
    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok)
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng',
      });

    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
    return this.issueSession(user, membership?.workspaceId ?? null, meta);
  }

  /**
   * Xoay refresh + cấp access mới. `preferredWorkspaceId` (lấy từ access token cũ) được giữ nếu user
   * vẫn còn là thành viên của workspace đó; ngược lại rơi về membership đầu tiên.
   */
  async refresh(refreshToken: string, meta: RefreshMeta, preferredWorkspaceId?: string | null) {
    const { userId, newToken } = await this.tokens.rotateRefresh(refreshToken, meta);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === 'DEACTIVATED') {
      // Bảo hiểm: lúc khoá đã thu hồi hết, nhưng token cấp lại muộn hơn (race) cũng không được sống tiếp.
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Tài khoản đã bị vô hiệu hoá',
      });
    }
    // "Hoạt động gần nhất": refresh xảy ra ≈ mỗi 15 phút khi đang dùng → cập nhật có giãn cách, không ghi DB mỗi request.
    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      void this.prisma.user
        .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    let workspaceId: string | null = null;
    if (preferredWorkspaceId) {
      const kept = await this.prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId: preferredWorkspaceId, userId } },
        select: { workspaceId: true },
      });
      workspaceId = kept?.workspaceId ?? null;
    }
    if (!workspaceId) {
      const first = await this.prisma.workspaceMembership.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { workspaceId: true },
      });
      workspaceId = first?.workspaceId ?? null;
    }
    const access = this.tokens.signAccess(user, workspaceId);
    return { ...access, refreshToken: newToken, user: this.publicUser(user) };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) await this.tokens.revokeFamilyByToken(refreshToken);
    return { success: true };
  }

  /** Đăng xuất mọi thiết bị: thu hồi mọi refresh token + access token cấp trước thời điểm này. */
  async logoutAll(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.user.update({ where: { id: userId }, data: { sessionsRevokedAt: now } });
    });
    // Ngắt mọi socket đang mở của user (kể cả thiết bị này — web đăng xuất ngay sau đó).
    this.events.emit(DOMAIN_EVENTS.ACCOUNT_SESSIONS_REVOKED, { userId });
    return { success: true };
  }

  async me(userId: string, workspaceId: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const roleRefSelect = { role: { select: { id: true, name: true, color: true } } };
    const wsMemberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      select: {
        id: true,
        workspaceId: true,
        roleId: true,
        role: { select: { name: true, scope: true } },
        roles: { select: roleRefSelect },
      },
    });
    const projMemberships = await this.prisma.projectMembership.findMany({
      where: { userId },
      select: {
        id: true,
        projectId: true,
        project: { select: { workspaceId: true } },
        roleId: true,
        role: { select: { name: true, scope: true } },
        roles: { select: roleRefSelect },
      },
    });
    const permissions: PermissionKey[] = workspaceId
      ? ([...(await this.rbac.getEffectivePermissions(userId, workspaceId))] as PermissionKey[])
      : [];
    // Gộp vai trò chính + phụ (dedupe theo id), giữ roleName là vai trò chính.
    const rolesOf = (
      primary: { roleId: string; role: { name: string } },
      extra: { role: { id: string; name: string; color: string | null } }[],
    ) => {
      const map = new Map<string, { id: string; name: string; color: string | null }>();
      for (const e of extra) map.set(e.role.id, e.role);
      if (!map.has(primary.roleId))
        map.set(primary.roleId, { id: primary.roleId, name: primary.role.name, color: null });
      return [...map.values()];
    };
    return {
      user: this.publicUser(user),
      workspaceId,
      memberships: [
        ...wsMemberships.map((m) => ({
          id: m.id,
          workspaceId: m.workspaceId,
          userId,
          roleId: m.roleId,
          roleName: m.role.name,
          roles: rolesOf(m, m.roles),
          scope: m.role.scope,
          projectId: null,
        })),
        ...projMemberships.map((m) => ({
          id: m.id,
          workspaceId: m.project.workspaceId,
          userId,
          roleId: m.roleId,
          roleName: m.role.name,
          roles: rolesOf(m, m.roles),
          scope: m.role.scope,
          projectId: m.projectId,
        })),
      ],
      permissions,
    };
  }

  /**
   * Danh sách workspace mà user là thành viên (kèm role và `memberCount`).
   * `memberCount` = số thành viên ĐANG HOẠT ĐỘNG: bỏ tài khoản bị vô hiệu hoá và user hệ thống (automation). Một truy vấn
   * (`_count` có điều kiện), chỉ của workspace mà người gọi là thành viên — không lộ workspace khác, không trả danh sách tên.
   */
  async listWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatarUrl: true,
            _count: {
              select: {
                memberships: {
                  where: {
                    user: { status: { not: 'DEACTIVATED' }, email: { not: SYSTEM_USER_EMAIL } },
                  },
                },
              },
            },
          },
        },
        role: { select: { name: true } },
      },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      avatarUrl: m.workspace.avatarUrl,
      roleName: m.role.name,
      memberCount: m.workspace._count.memberships,
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
      throw new ForbiddenAppException(
        'Bạn không phải thành viên của không gian làm việc này — hãy liên hệ quản trị viên để được thêm vào',
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.issueSession(user, workspaceId, meta);
  }

  /**
   * Cấp phiên mới (access + refresh) cho thiết bị đang dùng — sau khi chính user đổi mật khẩu (các phiên khác đã bị
   * thu hồi bằng `sessionsRevokedAt`, phiên này không bị đăng xuất giữa chừng).
   */
  async reissueSession(userId: string, workspaceId: string | null, meta: RefreshMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true },
    });
    const access = this.tokens.signAccess(user, workspaceId);
    const refreshToken = await this.tokens.issueRefresh(userId, null, meta);
    return { ...access, refreshToken };
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
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    timezone: string;
    locale: string;
    status: string;
    isSystemAdmin: boolean;
    canCreateWorkspace: boolean;
    lastSeenAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      timezone: u.timezone,
      locale: u.locale,
      status: u.status,
      isSystemAdmin: u.isSystemAdmin,
      canCreateWorkspace: u.canCreateWorkspace,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  private async uniqueSlug(
    tx: { workspace: { findUnique: (a: { where: { slug: string } }) => Promise<unknown> } },
    name: string,
  ): Promise<string> {
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
      if (i > 50) {
        slug = `${base}-${createId().slice(0, 6)}`;
        break;
      }
    }
    return slug;
  }
}
