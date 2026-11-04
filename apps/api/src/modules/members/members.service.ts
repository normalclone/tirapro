import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  DEFAULT_PROJECT_ROLE_BY_WS_ROLE,
  DOMAIN_EVENTS,
  ERROR_CODES,
  PERMISSIONS,
  roleLabel,
  type MemberUserDto,
  type RoleScope,
} from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  canSeeAdminUserFields,
  memberUserForViewer,
  toUserDto,
  USER_DTO_SELECT,
  type UserDtoSource,
} from '../../common/mappers/user.mapper';
import {
  AdminGrantRequiresAdminException,
  BusinessRuleException,
  ConflictAppException,
  EmailAlreadyRegisteredException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { generateTempPassword } from '../../common/password';
import { RbacService } from '../rbac/rbac.service';
import { touchedAdminRoleIds } from '../rbac/admin-grant';
import { ApiKeyService } from '../api-keys/api-key.service';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';
import type { CreateMemberAccountInput } from './members.schemas';

/** Người xem (AuthUser rút gọn) để quyết định có trả `isSystemAdmin`/`lastSeenAt` của thành viên không. */
type ViewerLike = { isSystemAdmin?: boolean; permissions?: readonly string[] };

type RoleRefRow = { role: { id: string; name: string; color: string | null } };

/**
 * Quản lý thành viên + GÁN NHIỀU VAI TRÒ ở cấp tổ chức và project.
 * roleId trên membership = vai trò chính (= roleIds[0]); join table giữ toàn bộ.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly apiKeys: ApiKeyService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── Tổ chức ─────────────────────────

  /**
   * Thành viên organization. `viewer`: người xem — `isSystemAdmin`/`lastSeenAt` của từng người chỉ trả khi viewer là admin hệ
   * thống hoặc có `member:manage` (người khác nhận bản rút gọn). Không truyền = bản đầy đủ (dùng nội bộ).
   */
  async listOrganization(organizationId: string, viewer?: ViewerLike) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        joinedAt: true,
        roleId: true,
        role: { select: { id: true, name: true, color: true } },
        user: { select: USER_DTO_SELECT },
        roles: { select: { role: { select: { id: true, name: true, color: true } } } },
      },
    });
    return this.forViewer(
      rows.map((m) => this.toMemberDto(m, m.role)),
      viewer,
    );
  }

  /** Rút gọn `user` của từng thành viên theo quyền người xem (xem `listOrganization`). */
  private forViewer<T extends { user: ReturnType<typeof toUserDto> }>(
    rows: T[],
    viewer?: ViewerLike,
  ): Array<Omit<T, 'user'> & { user: MemberUserDto }> {
    const privileged = !viewer || canSeeAdminUserFields(viewer);
    return rows.map((m) => ({ ...m, user: memberUserForViewer(m.user, privileged) }));
  }

  async addOrganization(
    organizationId: string,
    userId: string,
    roleIds: string[],
    actorId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, email: true },
    });
    if (!user) throw new NotFoundAppException('Người dùng');
    const existing = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    // Đã là thành viên → 409 (KHÔNG âm thầm ghi đè vai trò: thêm nhầm một Admin với vai trò Member = hạ quyền không cảnh
    // báo). Đổi vai trò đi qua `PUT /members/:userId/roles`.
    if (existing) throw this.alreadyMember();
    this.assertAddable([user]);
    const ids = await this.validateRoles(organizationId, roleIds, 'ORGANIZATION');
    await this.assertMayChangeAdminRoles(organizationId, actorId, () => Promise.resolve([]), ids);
    try {
      await this.prisma.organizationMembership.create({
        data: {
          organizationId,
          userId,
          roleId: ids[0]!,
          joinedAt: new Date(),
          roles: { create: ids.map((roleId) => ({ roleId })) },
        },
      });
    } catch (e) {
      // Hai request đồng thời cùng thêm một người: người thua nhận 409 (không phải 500).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw this.alreadyMember();
      throw e;
    }
    await this.rbac.invalidate(userId, organizationId);
    const member = await this.getOrganizationMember(organizationId, userId);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.MEMBER_ADDED,
      entityType: 'user',
      entityId: userId,
      summary: `Thêm ${this.label(member.user)} với vai trò ${this.roleNames(member.roles)}`,
      meta: { roleIds: ids },
    });
    this.emitMemberAdded(organizationId, [userId], actorId);
    return member;
  }

  /**
   * Báo "người vừa được thêm vào dự án" SAU commit: việc Jira đang chờ ở dự án riêng tư (từng bị giữ vì người đó chưa
   * thấy dự án) được thử gán lại.
   */
  private emitProjectAccess(
    organizationId: string,
    projectId: string,
    userIds: string[],
    actorId?: string,
  ): void {
    if (userIds.length === 0) return;
    this.events.emit(DOMAIN_EVENTS.PROJECT_ACCESS_CHANGED, {
      organizationId,
      projectId,
      userIds,
      actorId,
    });
  }

  /**
   * Quyền xem của người dùng có thể đã đổi (đổi vai trò organization/dự án) — phát SAU khi cache quyền đã xoá để gateway kiểm lại
   * socket của họ đang ở room project/issue và rút khi không còn thấy (không chờ tải lại trang).
   */
  private emitAccessChanged(organizationId: string, userIds: string[]): void {
    this.events.emit(DOMAIN_EVENTS.ACCESS_CHANGED, { organizationId, userIds });
  }

  /**
   * Báo "người mới vào tổ chức" SAU khi đã commit (L28: Jira import tự gán các việc đã nhớ email của họ).
   * Chỉ cho người thật sự được thêm — đổi vai trò của người đã là thành viên không phát.
   */
  private emitMemberAdded(organizationId: string, userIds: string[], actorId?: string): void {
    if (userIds.length === 0) return;
    this.events.emit(DOMAIN_EVENTS.MEMBER_ADDED, { organizationId, userIds, actorId });
  }

  /**
   * Tạo tài khoản mới + membership + vai trò trong MỘT transaction (không để lại tài khoản mồ côi khi bước
   * thêm thất bại). Mật khẩu tạm chỉ trả về ở đây, không lưu thô.
   */
  async createAccount(organizationId: string, actorId: string, input: CreateMemberAccountInput) {
    const email = input.email.toLowerCase();
    const exists = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
    if (exists) throw this.emailTakenError(email, exists.status);
    const ids = await this.validateRoles(organizationId, input.roleIds, 'ORGANIZATION');
    await this.assertMayChangeAdminRoles(organizationId, actorId, () => Promise.resolve([]), ids);
    const tempPassword = input.password ? undefined : generateTempPassword();
    const passwordHash = await argon2.hash(input.password ?? tempPassword!); // băm NGOÀI transaction (chậm)
    const userId = await this.createAccountTx(
      organizationId,
      actorId,
      input,
      email,
      ids,
      passwordHash,
    );
    await this.rbac.invalidate(userId, organizationId);
    const member = await this.getOrganizationMember(organizationId, userId);
    this.emitMemberAdded(organizationId, [userId], actorId);
    return { member, tempPassword };
  }

  /** Transaction tạo user + membership + nhật ký; hai request trùng email đồng thời → P2002 → cùng lỗi "đã có tài khoản". */
  private async createAccountTx(
    organizationId: string,
    actorId: string,
    input: CreateMemberAccountInput,
    email: string,
    ids: string[],
    passwordHash: string,
  ): Promise<string> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, displayName: input.displayName, passwordHash },
          select: { id: true },
        });
        await tx.organizationMembership.create({
          data: {
            organizationId,
            userId: user.id,
            roleId: ids[0]!,
            joinedAt: new Date(),
            roles: { create: ids.map((roleId) => ({ roleId })) },
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorId,
            action: AUDIT_ACTIONS.MEMBER_ACCOUNT_CREATED,
            entityType: 'user',
            entityId: user.id,
            summary: `Tạo tài khoản ${input.displayName} (${email}) và thêm vào tổ chức`,
            meta: { roleIds: ids },
          },
          tx,
        );
        return user.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw this.emailTakenError(email, 'ACTIVE');
      }
      throw e;
    }
  }

  /** Thông điệp đúng theo tình trạng tài khoản đang giữ email (không bảo "chọn trong danh sách" khi pool đã ẩn họ). */
  private emailTakenError(email: string, status: string) {
    if (email === SYSTEM_USER_EMAIL) {
      return new BusinessRuleException(
        'Email này dành riêng cho tài khoản hệ thống — hãy dùng email khác',
      );
    }
    if (status === 'DEACTIVATED') {
      return new BusinessRuleException(
        'Email này thuộc một tài khoản đã bị vô hiệu hoá — hãy nhờ quản trị hệ thống mở khoá, hoặc dùng email khác',
      );
    }
    return new EmailAlreadyRegisteredException();
  }

  /** Tài khoản vô hiệu hoá và người dùng hệ thống của automation không được thêm vào tổ chức. */
  private assertAddable(users: { status: string; email: string }[]): void {
    const bad = users.filter((u) => u.status === 'DEACTIVATED' || u.email === SYSTEM_USER_EMAIL);
    if (bad.length) {
      throw new BusinessRuleException(
        bad.length === 1
          ? 'Không thể thêm tài khoản đã bị vô hiệu hoá hoặc tài khoản hệ thống vào tổ chức'
          : `Có ${bad.length} tài khoản đã bị vô hiệu hoá hoặc là tài khoản hệ thống — bỏ họ khỏi danh sách rồi thử lại`,
      );
    }
  }

  private alreadyMember(): ConflictAppException {
    return new ConflictAppException(
      ERROR_CODES.ALREADY_MEMBER,
      'Người này đã là thành viên của tổ chức — đổi vai trò ở trang Thành viên',
    );
  }

  /** Số quản trị tổ chức (còn hoạt động) NGOÀI `exceptUserId`: giữ vai trò có quyền `organization:admin`. */
  private countOtherOrganizationAdmins(
    organizationId: string,
    exceptUserId: string,
  ): Promise<number> {
    return this.prisma.organizationMembership.count({
      where: {
        organizationId,
        userId: { not: exceptUserId },
        user: { status: { not: 'DEACTIVATED' } },
        roles: {
          some: {
            role: {
              permissions: { some: { permission: { key: PERMISSIONS.ORGANIZATION_ADMIN } } },
            },
          },
        },
      },
    });
  }

  /** `userId` đang là quản trị tổ chức (giữ vai trò có `organization:admin`)? */
  private async isOrganizationAdmin(organizationId: string, userId: string): Promise<boolean> {
    const n = await this.prisma.organizationMembership.count({
      where: {
        organizationId,
        userId,
        roles: {
          some: {
            role: {
              permissions: { some: { permission: { key: PERMISSIONS.ORGANIZATION_ADMIN } } },
            },
          },
        },
      },
    });
    return n > 0;
  }

  /** Chặn hạ/gỡ quản trị tổ chức CUỐI CÙNG — tự hạ vai trò hết admin sẽ buộc phải nhờ admin hệ thống khôi phục. */
  private async assertNotLastOrganizationAdmin(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    if (!(await this.isOrganizationAdmin(organizationId, userId))) return;
    if ((await this.countOtherOrganizationAdmins(organizationId, userId)) > 0) return;
    throw new ConflictAppException(
      ERROR_CODES.LAST_ORGANIZATION_ADMIN,
      'Đây là quản trị viên cuối cùng của tổ chức — hãy cấp quyền quản trị cho người khác trước',
    );
  }

  async setOrganizationRoles(
    organizationId: string,
    userId: string,
    roleIds: string[],
    actorId?: string,
  ) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundAppException('Thành viên');
    const ids = await this.validateRoles(organizationId, roleIds, 'ORGANIZATION');
    await this.assertMayChangeAdminRoles(
      organizationId,
      actorId,
      () => this.currentOrganizationRoleIds(organizationId, userId),
      ids,
    );
    // Bộ vai trò mới không còn quyền quản trị tổ chức → người này không được là quản trị viên cuối cùng.
    const keepsAdmin =
      (await this.prisma.role.count({
        where: {
          id: { in: ids },
          permissions: { some: { permission: { key: PERMISSIONS.ORGANIZATION_ADMIN } } },
        },
      })) > 0;
    if (!keepsAdmin) await this.assertNotLastOrganizationAdmin(organizationId, userId);
    await this.prisma.$transaction([
      this.prisma.organizationMembershipRole.deleteMany({ where: { membershipId: membership.id } }),
      this.prisma.organizationMembershipRole.createMany({
        data: ids.map((roleId) => ({ membershipId: membership.id, roleId })),
      }),
      this.prisma.organizationMembership.update({
        where: { id: membership.id },
        data: { roleId: ids[0]! },
      }),
    ]);
    await this.rbac.invalidate(userId, organizationId);
    this.emitAccessChanged(organizationId, [userId]);
    const member = await this.getOrganizationMember(organizationId, userId);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.MEMBER_ROLES_CHANGED,
      entityType: 'user',
      entityId: userId,
      summary: `Đổi vai trò của ${this.label(member.user)} thành ${this.roleNames(member.roles)}`,
      meta: { roleIds: ids },
    });
    return member;
  }

  /** Thêm NHIỀU người vào tổ chức cùng bộ vai trò; bỏ qua người đã là thành viên. */
  async addOrganizationMany(
    organizationId: string,
    userIds: string[],
    roleIds: string[],
    actorId?: string,
  ) {
    const ids = await this.validateRoles(organizationId, roleIds, 'ORGANIZATION');
    await this.assertMayChangeAdminRoles(organizationId, actorId, () => Promise.resolve([]), ids);
    const unique = [...new Set(userIds)];
    const existUsers = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, status: true, email: true },
    });
    const valid = new Set(existUsers.map((u) => u.id));
    const already = await this.prisma.organizationMembership.findMany({
      where: { organizationId, userId: { in: [...valid] } },
      select: { userId: true },
    });
    const alreadySet = new Set(already.map((a) => a.userId));
    const toAdd = [...valid].filter((u) => !alreadySet.has(u));
    this.assertAddable(existUsers.filter((u) => toAdd.includes(u.id)));
    if (toAdd.length) {
      // Một transaction cho cả lô: hoặc thêm đủ, hoặc không thêm ai. skipDuplicates để hai request đồng thời
      // thêm cùng một người không làm cả lô thất bại; vai trò chỉ gán cho membership chưa có vai trò nào.
      await this.prisma.$transaction(async (tx) => {
        await tx.organizationMembership.createMany({
          data: toAdd.map((userId) => ({
            organizationId,
            userId,
            roleId: ids[0]!,
            joinedAt: new Date(),
          })),
          skipDuplicates: true,
        });
        const fresh = await tx.organizationMembership.findMany({
          where: { organizationId, userId: { in: toAdd }, roles: { none: {} } },
          select: { id: true },
        });
        await tx.organizationMembershipRole.createMany({
          data: fresh.flatMap((m) => ids.map((roleId) => ({ membershipId: m.id, roleId }))),
          skipDuplicates: true,
        });
      });
      await this.rbac.invalidateOrganization(organizationId);
      await this.audit.record({
        organizationId,
        actorId,
        action: AUDIT_ACTIONS.MEMBER_ADDED,
        entityType: 'user',
        summary: `Thêm ${toAdd.length} thành viên vào tổ chức`,
        meta: { userIds: toAdd, roleIds: ids },
      });
      this.emitMemberAdded(organizationId, toAdd, actorId);
    }
    return { added: toAdd.length, skipped: unique.length - toAdd.length };
  }

  async removeOrganization(organizationId: string, userId: string, actingUserId: string) {
    if (userId === actingUserId) throw new ForbiddenAppException('Không thể tự gỡ chính mình');
    const ws = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true },
    });
    if (ws?.ownerId === userId)
      throw new ForbiddenAppException(
        'Không thể gỡ chủ sở hữu của tổ chức — hãy chuyển quyền sở hữu cho người khác trước',
      );
    // Gỡ một quản trị khỏi tổ chức = gỡ quyền quản trị của họ → cũng chỉ quản trị mới làm được (P-C14).
    await this.assertMayChangeAdminRoles(
      organizationId,
      actingUserId,
      () => this.currentOrganizationRoleIds(organizationId, userId),
      [],
    );
    await this.assertNotLastOrganizationAdmin(organizationId, userId);
    const who = await this.userLabel(userId);
    // Không để dự án riêng tư mất người cuối cùng (chỉ còn quản trị tổ chức thấy) — chặn kèm lối thoát.
    const sole = await this.privateProjectsWithOnlyMember(organizationId, userId);
    if (sole.length > 0) {
      // Chỉ nêu khoá dự án người gọi XEM ĐƯỢC; phần còn lại gộp "và N dự án khác" (không lộ mã dự án riêng tư của người khác).
      const visible: string[] = [];
      for (const p of sole)
        if (await this.canSeeProject(actingUserId, organizationId, p.id)) visible.push(p.key);
      const hidden = sole.length - visible.length;
      const parts = [
        visible.length ? `dự án riêng tư ${visible.join(', ')}` : '',
        hidden ? `${visible.length ? 'và ' : ''}${hidden} dự án riêng tư khác` : '',
      ].filter(Boolean);
      throw new BusinessRuleException(
        `${who} là thành viên duy nhất của ${parts.join(' ')} — hãy thêm người khác vào dự án (Cấu hình dự án → Thành viên) hoặc chuyển dự án sang công khai trước khi gỡ`,
      );
    }
    // Một transaction: gỡ membership + xoá ghi đè vai trò dự án của tổ chức này + thu hồi API key.
    // Thiếu bước nào thì người bị gỡ vẫn giữ được quyền qua key/ghi đè dự án còn sót.
    const revokedPrefixes = await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.delete({
        where: { organizationId_userId: { organizationId, userId } },
      });
      await tx.projectMembership.deleteMany({ where: { userId, project: { organizationId } } });
      return this.apiKeys.revokeAllForUser(organizationId, userId, tx);
    });
    await this.apiKeys.dropCaches(revokedPrefixes);
    await this.rbac.invalidate(userId, organizationId);
    // Gateway ngắt mọi socket của user này đang ở tổ chức đó (room org:<id>).
    this.events.emit(DOMAIN_EVENTS.MEMBER_REMOVED, { organizationId, userId });
    await this.audit.record({
      organizationId,
      actorId: actingUserId,
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      entityType: 'user',
      entityId: userId,
      summary: `Gỡ ${who} khỏi tổ chức`,
    });
    return { success: true };
  }

  private async canSeeProject(
    viewerId: string,
    organizationId: string,
    projectId: string,
  ): Promise<boolean> {
    try {
      await this.rbac.assertProjectVisible(viewerId, organizationId, projectId);
      return true;
    } catch (e) {
      if (e instanceof NotFoundAppException) return false;
      throw e;
    }
  }

  /** Các dự án riêng tư (chưa xoá) mà `userId` là thành viên DUY NHẤT còn thuộc organization. */
  private async privateProjectsWithOnlyMember(
    organizationId: string,
    userId: string,
  ): Promise<Array<{ id: string; key: string }>> {
    const rows = await this.prisma.project.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isPrivate: true,
        memberships: { some: { userId } },
      },
      select: {
        id: true,
        key: true,
        // Chỉ tính thành viên còn thuộc tổ chức (dòng của người đã rời tổ chức không còn ý nghĩa).
        memberships: {
          where: { user: { organizationMemberships: { some: { organizationId } } } },
          select: { userId: true },
        },
      },
      orderBy: { key: 'asc' },
    });
    return rows
      .filter((p) => p.memberships.every((m) => m.userId === userId))
      .map((p) => ({ id: p.id, key: p.key }));
  }

  // ───────────────────────── Project ─────────────────────────

  /** Dự án PHẢI thuộc tổ chức của người gọi (chống truy cập chéo tenant). Trả về dự án khi hợp lệ. */
  private async requireProject(organizationId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true, name: true, isPrivate: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  /**
   * Thành viên DỰ ÁN = TOÀN BỘ thành viên tổ chức (dự án dùng chung tập người dùng).
   * Vai trò hiển thị là vai trò HIỆU LỰC: ghi đè riêng ở dự án nếu có, ngược lại là
   * vai trò mặc định suy từ vai trò tổ chức (`DEFAULT_PROJECT_ROLE_BY_WS_ROLE`).
   */
  async listProject(organizationId: string, projectId: string, viewer?: ViewerLike) {
    const project = await this.requireProject(organizationId, projectId);
    const [wsRows, overrides, projectRoles] = await Promise.all([
      this.prisma.organizationMembership.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          joinedAt: true,
          roleId: true,
          role: { select: { id: true, name: true, color: true } },
          user: { select: USER_DTO_SELECT },
          roles: { select: { role: { select: { id: true, name: true, color: true } } } },
        },
      }),
      this.prisma.projectMembership.findMany({
        where: { projectId },
        select: {
          id: true,
          userId: true,
          roleId: true,
          role: { select: { id: true, name: true, color: true } },
          roles: { select: { role: { select: { id: true, name: true, color: true } } } },
        },
      }),
      this.prisma.role.findMany({
        where: { scope: 'PROJECT', OR: [{ organizationId }, { organizationId: null }] },
        select: { id: true, name: true, color: true },
      }),
    ]);
    const overrideByUser = new Map(overrides.map((o) => [o.userId, o]));
    // Dự án riêng tư: thành viên = chỉ các dòng ProjectMembership (không có "mặc định theo tổ chức").
    const visibleRows = project.isPrivate
      ? wsRows.filter((m) => overrideByUser.has(m.user.id))
      : wsRows;
    const projRoleByName = new Map(projectRoles.map((r) => [r.name, r]));

    const out = visibleRows.map((m) => {
      const ov = overrideByUser.get(m.user.id);
      if (ov) {
        return {
          ...this.toMemberDto({ id: ov.id, user: m.user, roles: ov.roles }, ov.role),
          isOverride: true,
        };
      }
      // Vai trò mặc định theo vai trò tổ chức của người này.
      const defaults: { id: string; name: string; color: string | null }[] = [];
      for (const r of m.roles.length ? m.roles : [{ role: m.role }]) {
        const target = DEFAULT_PROJECT_ROLE_BY_WS_ROLE[r.role.name];
        const found = target ? projRoleByName.get(target) : undefined;
        if (found && !defaults.some((d) => d.id === found.id)) defaults.push(found);
      }
      return {
        membershipId: m.id,
        user: toUserDto(m.user),
        roles: defaults,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        isOverride: false,
      };
    });
    return this.forViewer(out, viewer);
  }

  /** Xoá GHI ĐÈ vai trò ở dự án → người này quay về vai trò mặc định của organization. */
  async clearProjectOverride(
    organizationId: string,
    projectId: string,
    userId: string,
    actorId?: string,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    await this.assertMayChangeAdminRoles(
      organizationId,
      actorId,
      () => this.currentProjectRoleIds(projectId, userId),
      [],
    );
    if (project.isPrivate) {
      // Dự án riêng tư: gỡ ghi đè = GỠ KHỎI DỰ ÁN. Không để dự án không còn thành viên nào (mồ côi).
      const members = await this.prisma.projectMembership.count({
        where: { projectId, user: { organizationMemberships: { some: { organizationId } } } },
      });
      const isMember = await this.prisma.projectMembership.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { id: true },
      });
      if (isMember && members <= 1)
        throw new BusinessRuleException('Dự án phải còn ít nhất một thành viên');
    }
    const { count } = await this.prisma.projectMembership.deleteMany({
      where: { projectId, userId },
    });
    await this.rbac.invalidate(userId, organizationId);
    if (count === 0) return { success: true }; // không có vai trò riêng để gỡ → không ghi nhật ký
    // Gỡ khỏi dự án (riêng tư): realtime rút socket của họ khỏi room project nếu không còn thấy dự án (kiểm lại ở gateway).
    this.events.emit(DOMAIN_EVENTS.PROJECT_MEMBER_REMOVED, { organizationId, projectId, userId });
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_MEMBER_REMOVED,
      entityType: 'user',
      entityId: userId,
      summary: project.isPrivate
        ? `Gỡ ${await this.userLabel(userId)} khỏi dự án riêng tư "${project.name}"`
        : `Gỡ vai trò riêng của ${await this.userLabel(userId)} trong dự án "${project.name}"`,
      meta: { projectId },
    });
    return { success: true };
  }

  async addProject(
    organizationId: string,
    projectId: string,
    userId: string,
    roleIds: string[],
    actorId?: string,
  ): Promise<Awaited<ReturnType<MembersService['getProjectMember']>>> {
    const project = await this.requireProject(organizationId, projectId);
    await this.assertOrganizationMember(organizationId, userId);
    const ids = await this.validateRoles(organizationId, roleIds, 'PROJECT');
    const existing = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    if (existing) return this.setProjectRoles(organizationId, projectId, userId, roleIds, actorId);
    await this.assertMayChangeAdminRoles(organizationId, actorId, () => Promise.resolve([]), ids);

    const member = await this.createProjectMembership(organizationId, projectId, userId, ids);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
      entityType: 'user',
      entityId: userId,
      summary: `Thêm ${this.label(member.user)} vào dự án "${project.name}" với vai trò ${this.roleNames(member.roles)}`,
      meta: { projectId, roleIds: ids },
    });
    this.emitProjectAccess(organizationId, projectId, [userId], actorId);
    return member;
  }

  async setProjectRoles(
    organizationId: string,
    projectId: string,
    userId: string,
    roleIds: string[],
    actorId?: string,
  ): Promise<Awaited<ReturnType<MembersService['getProjectMember']>>> {
    const project = await this.requireProject(organizationId, projectId);
    const membership = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    });
    // Chưa có ghi đè → TẠO MỚI (mọi thành viên tổ chức đều thuộc dự án theo mặc định,
    // đặt vai trò riêng ở đây chính là tạo bản ghi đè) — ghi nhật ký là "đặt vai trò riêng", không phải "thêm vào dự án".
    if (!membership) {
      await this.assertOrganizationMember(organizationId, userId);
      const newIds = await this.validateRoles(organizationId, roleIds, 'PROJECT');
      await this.assertMayChangeAdminRoles(
        organizationId,
        actorId,
        () => Promise.resolve([]),
        newIds,
      );
      const created = await this.createProjectMembership(organizationId, projectId, userId, newIds);
      await this.audit.record({
        organizationId,
        actorId,
        action: AUDIT_ACTIONS.PROJECT_MEMBER_ROLES_CHANGED,
        entityType: 'user',
        entityId: userId,
        summary: `Đặt vai trò riêng của ${this.label(created.user)} trong dự án "${project.name}" thành ${this.roleNames(created.roles)}`,
        meta: { projectId, roleIds: newIds },
      });
      this.emitProjectAccess(organizationId, projectId, [userId], actorId);
      return created;
    }
    const ids = await this.validateRoles(organizationId, roleIds, 'PROJECT');
    await this.assertMayChangeAdminRoles(
      organizationId,
      actorId,
      () => this.currentProjectRoleIds(projectId, userId),
      ids,
    );
    await this.prisma.$transaction([
      this.prisma.projectMembershipRole.deleteMany({ where: { membershipId: membership.id } }),
      this.prisma.projectMembershipRole.createMany({
        data: ids.map((roleId) => ({ membershipId: membership.id, roleId })),
      }),
      this.prisma.projectMembership.update({
        where: { id: membership.id },
        data: { roleId: ids[0]! },
      }),
    ]);
    await this.rbac.invalidate(userId, organizationId);
    this.emitAccessChanged(organizationId, [userId]);
    const member = await this.getProjectMember(projectId, userId);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.PROJECT_MEMBER_ROLES_CHANGED,
      entityType: 'user',
      entityId: userId,
      summary: `Đổi vai trò của ${this.label(member.user)} trong dự án "${project.name}" thành ${this.roleNames(member.roles)}`,
      meta: { projectId, roleIds: ids },
    });
    return member;
  }

  /** Người được đặt vai trò ở dự án phải là thành viên tổ chức của dự án. */
  private async assertOrganizationMember(organizationId: string, userId: string): Promise<void> {
    const isMember = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true },
    });
    if (!isMember)
      throw new ForbiddenAppException(
        'Người dùng chưa thuộc tổ chức này — hãy thêm họ vào tổ chức trước',
      );
  }

  private async createProjectMembership(
    organizationId: string,
    projectId: string,
    userId: string,
    ids: string[],
  ) {
    // Tạo ghi đè mới: không đặt vai trò dự án cho tài khoản vô hiệu hoá / người dùng hệ thống (như thêm vào tổ chức).
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, email: true },
    });
    if (!user) throw new NotFoundAppException('Người dùng');
    this.assertAddable([user]);
    await this.prisma.projectMembership.create({
      data: {
        projectId,
        userId,
        roleId: ids[0]!,
        roles: { create: ids.map((roleId) => ({ roleId })) },
      },
    });
    await this.rbac.invalidate(userId, organizationId);
    this.emitAccessChanged(organizationId, [userId]); // vai trò riêng ở dự án có thể HẠ quyền so với vai trò tổ chức
    return this.getProjectMember(projectId, userId);
  }

  /** Thêm NHIỀU người vào dự án cùng bộ vai trò; chỉ nhận người ĐÃ thuộc tổ chức, bỏ qua người đã ở dự án. */
  async addProjectMany(
    organizationId: string,
    projectId: string,
    userIds: string[],
    roleIds: string[],
    actorId?: string,
  ) {
    const project = await this.requireProject(organizationId, projectId);
    const ids = await this.validateRoles(organizationId, roleIds, 'PROJECT');
    await this.assertMayChangeAdminRoles(organizationId, actorId, () => Promise.resolve([]), ids);
    const unique = [...new Set(userIds)];
    const wsMembers = await this.prisma.organizationMembership.findMany({
      where: { organizationId, userId: { in: unique } },
      select: { userId: true },
    });
    const wsSet = new Set(wsMembers.map((m) => m.userId));
    const valid = unique.filter((u) => wsSet.has(u));
    const already = await this.prisma.projectMembership.findMany({
      where: { projectId, userId: { in: valid } },
      select: { userId: true },
    });
    const alreadySet = new Set(already.map((a) => a.userId));
    const toAdd = valid.filter((u) => !alreadySet.has(u));
    if (toAdd.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: toAdd } },
        select: { status: true, email: true },
      });
      this.assertAddable(users);
      await this.prisma.$transaction(async (tx) => {
        await tx.projectMembership.createMany({
          data: toAdd.map((userId) => ({ projectId, userId, roleId: ids[0]! })),
          skipDuplicates: true,
        });
        const fresh = await tx.projectMembership.findMany({
          where: { projectId, userId: { in: toAdd }, roles: { none: {} } },
          select: { id: true },
        });
        await tx.projectMembershipRole.createMany({
          data: fresh.flatMap((m) => ids.map((roleId) => ({ membershipId: m.id, roleId }))),
          skipDuplicates: true,
        });
      });
      await this.rbac.invalidateOrganization(organizationId);
      await this.audit.record({
        organizationId,
        actorId,
        action: AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
        entityType: 'user',
        summary: `Thêm ${toAdd.length} người vào dự án "${project.name}"`,
        meta: { projectId, userIds: toAdd, roleIds: ids },
      });
      this.emitProjectAccess(organizationId, projectId, toAdd, actorId);
    }
    return { added: toAdd.length, skipped: unique.length - toAdd.length };
  }

  // ───────────────────────── helpers ─────────────────────────

  /**
   * P-C14: chỉ người đang giữ `organization:admin` (hoặc admin hệ thống) mới THÊM/GỠ vai trò mang `organization:admin` cho ai đó
   * — `member:manage` một mình không đủ (nếu không, người quản lý thành viên tự nâng mình lên quản trị). Quản trị: một lần
   * hỏi quyền (có cache), không tra thêm. Chưa phải quản trị: so bộ vai trò trước/sau, chỉ chặn khi có vai trò quản trị
   * bị thêm/gỡ. Không có `actorId` (gọi nội bộ: seed, đăng ký, nhóm) → không áp luật.
   */
  private async assertMayChangeAdminRoles(
    organizationId: string,
    actorId: string | undefined,
    before: () => Promise<string[]>,
    after: string[],
  ): Promise<void> {
    if (!actorId) return;
    if (await this.rbac.holdsOrganizationAdmin(actorId, organizationId)) return;
    const prev = await before();
    const admins = await this.rbac.adminRoleIds([...prev, ...after]);
    if (touchedAdminRoleIds(prev, after, admins).length > 0)
      throw new AdminGrantRequiresAdminException();
  }

  /** Mọi vai trò tổ chức hiện có của người này (bảng nối + vai trò chính, phòng membership cũ chưa ghi bảng nối). */
  private async currentOrganizationRoleIds(
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    const m = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { roleId: true, roles: { select: { roleId: true } } },
    });
    return m ? [...new Set([m.roleId, ...m.roles.map((r) => r.roleId)].filter(Boolean))] : [];
  }

  /** Vai trò RIÊNG của người này ở dự án (ghi đè); rỗng nếu chưa có. */
  private async currentProjectRoleIds(projectId: string, userId: string): Promise<string[]> {
    const m = await this.prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { roleId: true, roles: { select: { roleId: true } } },
    });
    return m ? [...new Set([m.roleId, ...m.roles.map((r) => r.roleId)].filter(Boolean))] : [];
  }

  /** "Tên (email)" để dựng câu mô tả nhật ký. */
  private label(user: { displayName: string; email: string }): string {
    return `${user.displayName} (${user.email})`;
  }

  /** Nhãn tiếng Việt hiển thị (vai trò hệ thống) — câu `summary` lưu vĩnh viễn nên phải đúng ngôn ngữ ngay lúc ghi. */
  private roleNames(roles: { name: string }[]): string {
    return roles.map((r) => roleLabel(r.name)).join(', ') || '—';
  }

  private async userLabel(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, email: true },
    });
    return u ? this.label(u) : userId;
  }

  private async getOrganizationMember(organizationId: string, userId: string) {
    const m = await this.prisma.organizationMembership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        joinedAt: true,
        roleId: true,
        role: { select: { id: true, name: true, color: true } },
        user: { select: USER_DTO_SELECT },
        roles: { select: { role: { select: { id: true, name: true, color: true } } } },
      },
    });
    return this.toMemberDto(m, m.role);
  }

  private async getProjectMember(projectId: string, userId: string) {
    const m = await this.prisma.projectMembership.findUniqueOrThrow({
      where: { projectId_userId: { projectId, userId } },
      select: {
        id: true,
        roleId: true,
        role: { select: { id: true, name: true, color: true } },
        user: { select: USER_DTO_SELECT },
        roles: { select: { role: { select: { id: true, name: true, color: true } } } },
      },
    });
    return this.toMemberDto(m, m.role);
  }

  /** Mỗi role phải tồn tại (system hoặc của tổ chức) và đúng scope của cấp đang gán. */
  private async validateRoles(
    organizationId: string,
    roleIds: string[],
    scope: RoleScope,
  ): Promise<string[]> {
    const unique = [...new Set(roleIds)];
    const found = await this.prisma.role.findMany({
      where: { id: { in: unique }, scope, OR: [{ organizationId }, { organizationId: null }] },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new ForbiddenAppException(
        `Một số vai trò không hợp lệ cho cấp ${scope === 'PROJECT' ? 'dự án' : 'tổ chức'}`,
      );
    }
    // Giữ thứ tự gốc (roleIds[0] = vai trò chính).
    const set = new Set(found.map((r) => r.id));
    return unique.filter((id) => set.has(id));
  }

  /**
   * `primary` = vai trò chính (cột roleId): khi bảng nối rỗng (membership tạo bởi đường quên ghi bảng nối,
   * hoặc race giữa tạo và `roles.create`) thì rơi về nó thay vì trả `roles: []` ("Chưa có vai trò").
   */
  private toMemberDto(
    m: {
      id: string;
      joinedAt?: Date | null;
      user: UserDtoSource;
      roles: RoleRefRow[];
    },
    primary?: { id: string; name: string; color: string | null } | null,
  ) {
    return {
      membershipId: m.id,
      user: toUserDto(m.user),
      roles: m.roles.length
        ? m.roles.map((r) => ({ id: r.role.id, name: r.role.name, color: r.role.color }))
        : primary
          ? [{ id: primary.id, name: primary.name, color: primary.color }]
          : [],
      joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
    };
  }
}
