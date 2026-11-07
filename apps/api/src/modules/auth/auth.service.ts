import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createId } from '@paralleldrive/cuid2';
import { DOMAIN_EVENTS, SYSTEM_ROLES, type PermissionKey } from '@tirapro/types';
import type { LoginInput, RegisterInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { RbacService } from '../rbac/rbac.service';
import { ACTIVE_MEMBERSHIP_COUNT } from '../../common/active-member';
import { OrganizationBootstrapService } from '../organizations/organization-bootstrap.service';
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
    private readonly bootstrap: OrganizationBootstrapService,
    private readonly settings: SystemSettingsService,
    private readonly events: EventEmitter2,
  ) {}

  async register(input: RegisterInput, meta: RefreshMeta) {
    if (!this.settings.flags().signupEnabled) {
      throw new ForbiddenAppException(
        'Đăng ký công khai đang tắt. Liên hệ Quản trị để được cấp tài khoản.',
      );
    }
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing)
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email đã được đăng ký' });

    const passwordHash = await argon2.hash(input.password);
    const wsName = input.organizationName?.trim() || `Tổ chức của ${input.displayName}`;

    const { user, organizationId } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, displayName: input.displayName },
      });
      const slug = await this.uniqueSlug(tx, wsName);
      const ws = await tx.organization.create({
        data: { name: wsName, slug, ownerId: user.id, plan: 'FREE', createdById: user.id },
      });
      await this.bootstrap.bootstrap(tx, ws.id);
      const adminRole = await tx.role.findFirst({
        where: {
          name: SYSTEM_ROLES.ORGANIZATION_ADMIN,
          scope: 'ORGANIZATION',
          organizationId: null,
          isSystem: true,
        },
        select: { id: true },
      });
      if (!adminRole)
        throw new Error(
          'System role chưa được seed (chạy pnpm --filter @tirapro/api run db:seed:roles)',
        );
      await tx.organizationMembership.create({
        data: {
          organizationId: ws.id,
          userId: user.id,
          roleId: adminRole.id,
          joinedAt: new Date(),
          // Bảng nối mới là nguồn sự thật cho UI (vai trò hiển thị, đếm thành viên) — ghi cùng cột roleId cũ.
          roles: { create: [{ roleId: adminRole.id }] },
        },
      });
      return { user, organizationId: ws.id };
    });

    return this.issueSession(user, organizationId, meta);
  }

  async login(input: LoginInput, meta: RefreshMeta) {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
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
    // Chỉ sau khi mật khẩu ĐÚNG mới báo tài khoản bị vô hiệu hoá: không lộ "email này có tồn tại" cho
    // người dò mật khẩu, nhưng người đúng mật khẩu thì biết rõ lý do không vào được (không phải sai mật khẩu).
    if (user.status === 'DEACTIVATED')
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'Tài khoản của bạn đã bị vô hiệu hoá. Vui lòng liên hệ quản trị để được hỗ trợ.',
      });

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
    return this.issueSession(user, membership?.organizationId ?? null, meta);
  }

  /**
   * Xoay refresh + cấp access mới. `preferredOrganizationId` (lấy từ access token cũ) được giữ nếu user
   * vẫn còn là thành viên của tổ chức đó; ngược lại rơi về membership đầu tiên.
   */
  async refresh(refreshToken: string, meta: RefreshMeta, preferredOrganizationId?: string | null) {
    const {
      userId,
      newToken,
      organizationId: tokenOrganizationId,
    } = await this.tokens.rotateRefresh(refreshToken, meta);
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
    // Ưu tiên: tổ chức trong access token cũ (header) → tổ chức lưu trong refresh token (vừa chuyển rồi tải lại
    // trang, access token trong bộ nhớ đã mất) → tổ chức tham gia sớm nhất. Luôn kiểm còn là thành viên.
    let organizationId: string | null = null;
    for (const candidate of [preferredOrganizationId, tokenOrganizationId]) {
      if (!candidate || organizationId) continue;
      const kept = await this.prisma.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: candidate, userId } },
        select: { organizationId: true },
      });
      organizationId = kept?.organizationId ?? null;
    }
    if (!organizationId) {
      const first = await this.prisma.organizationMembership.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { organizationId: true },
      });
      organizationId = first?.organizationId ?? null;
    }
    if (newToken && organizationId !== tokenOrganizationId)
      await this.tokens.setRefreshOrganization(newToken, organizationId);
    const access = this.tokens.signAccess(user, organizationId);
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

  async me(userId: string, organizationId: string | null) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const roleRefSelect = { role: { select: { id: true, name: true, color: true } } };
    const wsMemberships = await this.prisma.organizationMembership.findMany({
      where: { userId },
      select: {
        id: true,
        organizationId: true,
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
        project: { select: { organizationId: true } },
        roleId: true,
        role: { select: { name: true, scope: true } },
        roles: { select: roleRefSelect },
      },
    });
    const permissions: PermissionKey[] = organizationId
      ? ([...(await this.rbac.getEffectivePermissions(userId, organizationId))] as PermissionKey[])
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
      organizationId,
      memberships: [
        ...wsMemberships.map((m) => ({
          id: m.id,
          organizationId: m.organizationId,
          userId,
          roleId: m.roleId,
          roleName: m.role.name,
          roles: rolesOf(m, m.roles),
          scope: m.role.scope,
          projectId: null,
        })),
        ...projMemberships.map((m) => ({
          id: m.id,
          organizationId: m.project.organizationId,
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
   * Danh sách tổ chức mà user là thành viên (kèm role và `memberCount`).
   * `memberCount` = số thành viên ĐANG HOẠT ĐỘNG: bỏ tài khoản bị vô hiệu hoá và user hệ thống (automation).
   * Một lời gọi Prisma (khoảng 3 câu SQL: membership, tổ chức, đếm), không N+1 — chỉ của tổ chức mà người gọi là
   * thành viên; không lộ tổ chức khác, không trả danh sách tên.
   * Vị từ `SYSTEM_USER_EMAIL` là lưới an toàn: user hệ thống không bao giờ có membership (`addOrganization` chặn).
   */
  async listOrganizations(userId: string) {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            avatarUrl: true,
            _count: {
              select: { memberships: ACTIVE_MEMBERSHIP_COUNT },
            },
          },
        },
        role: { select: { name: true } },
      },
    });
    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      avatarUrl: m.organization.avatarUrl,
      roleName: m.role.name,
      memberCount: m.organization._count.memberships,
    }));
  }

  /**
   * Chuyển organization: xác minh user là thành viên của tổ chức đích, rồi cấp
   * session mới (access token mang organizationId mới + xoay refresh) — y hệt login.
   */
  async switchOrganization(userId: string, organizationId: string, meta: RefreshMeta) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenAppException(
        'Bạn không phải thành viên của tổ chức này — hãy liên hệ quản trị viên để được thêm vào',
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.issueSession(user, organizationId, meta);
  }

  /**
   * Cấp phiên mới (access + refresh) cho thiết bị đang dùng — sau khi chính user đổi mật khẩu (các phiên khác đã bị
   * thu hồi bằng `sessionsRevokedAt`, phiên này không bị đăng xuất giữa chừng).
   */
  async reissueSession(userId: string, organizationId: string | null, meta: RefreshMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true },
    });
    const access = this.tokens.signAccess(user, organizationId);
    const refreshToken = await this.tokens.issueRefresh(userId, null, meta, organizationId);
    return { ...access, refreshToken };
  }

  private async issueSession(
    user: { id: string; email: string },
    organizationId: string | null,
    meta: RefreshMeta,
  ) {
    const access = this.tokens.signAccess(user, organizationId);
    const refreshToken = await this.tokens.issueRefresh(user.id, null, meta, organizationId);
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
    canCreateOrganization: boolean;
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
      canCreateOrganization: u.canCreateOrganization,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  private async uniqueSlug(
    tx: { organization: { findUnique: (a: { where: { slug: string } }) => Promise<unknown> } },
    name: string,
  ): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'organization';
    let slug = base;
    let i = 1;
    while (await tx.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
      if (i > 50) {
        slug = `${base}-${createId().slice(0, 6)}`;
        break;
      }
    }
    return slug;
  }
}
