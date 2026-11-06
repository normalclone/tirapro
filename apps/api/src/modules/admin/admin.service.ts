import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AUDIT_ACTIONS, DOMAIN_EVENTS, SYSTEM_ROLES } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  EmailAlreadyRegisteredException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { offsetPage } from '../../common/dto/page-result';
import { generateTempPassword } from '../../common/password';
import { AuditService } from '../audit/audit.service';
import { ApiKeyService } from '../api-keys/api-key.service';
import { AdminSyncService } from '../members/admin-sync';
import { MembersService } from '../members/members.service';
import { RbacService } from '../rbac/rbac.service';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';
import type {
  AddToOrganizationInput,
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
} from './admin.schemas';

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  isSystemAdmin: true,
  canCreateOrganization: true,
  lastSeenAt: true,
  createdAt: true,
  _count: { select: { organizationMemberships: true } },
} as const;

type Row = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  isSystemAdmin: boolean;
  canCreateOrganization: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  _count: { organizationMemberships: number };
};

/** Quản trị tài khoản toàn hệ thống (chỉ admin hệ thống). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly members: MembersService,
    private readonly apiKeys: ApiKeyService,
    private readonly events: EventEmitter2,
    private readonly adminSync: AdminSyncService,
    private readonly rbac: RbacService,
  ) {}

  /** Vai trò tổ chức của người này vừa đổi ở các tổ chức đó → xoá cache quyền (`rbac:*`) như các chỗ đổi vai trò khác. */
  private async invalidateOrganizations(userId: string, organizationIds: string[]): Promise<void> {
    await Promise.all(organizationIds.map((o) => this.rbac.invalidate(userId, o)));
  }

  /** Sau khi thu hồi phiên: ngắt mọi socket đang mở của user (gateway lo cả node khác qua Redis adapter). */
  private emitSessionsRevoked(userId: string): void {
    this.events.emit(DOMAIN_EVENTS.ACCOUNT_SESSIONS_REVOKED, { userId });
  }

  private toDto(u: Row) {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      status: u.status,
      isSystemAdmin: u.isSystemAdmin,
      canCreateOrganization: u.canCreateOrganization,
      // Tài khoản nội bộ của tự động hoá: không khoá / đặt lại mật khẩu được → web ẩn menu thao tác.
      isAutomation: u.email === SYSTEM_USER_EMAIL,
      organizationCount: u._count.organizationMemberships,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  async list(query: ListUsersQuery = {}) {
    const and: Prisma.UserWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.search) {
      and.push({
        OR: [
          { displayName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    const rows = await this.prisma.user.findMany({
      where: and.length ? { AND: and } : undefined,
      // Người hoạt động gần đây lên đầu; người chưa từng đăng nhập xuống cuối (theo ngày tạo).
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: USER_SELECT,
    });
    const data = rows.map((r) => this.toDto(r as Row));
    // Danh sách "all-in-one" (không phân trang) — vẫn bọc envelope theo cross-cutting decision.
    return offsetPage(data, 1, Math.max(1, data.length), data.length);
  }

  async create(input: CreateUserInput, actorId?: string) {
    const email = input.email.toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) throw new BusinessRuleException('Email đã tồn tại');

    // Tạo tài khoản bởi admin hệ thống có thể trả mật khẩu tạm; để thêm người vào tổ chức dùng POST /members (người có sẵn) hoặc POST /members/accounts (tạo mới).
    let tempPassword: string | undefined;
    // Mật khẩu tạm: ngẫu nhiên bằng crypto, luôn thoả chính sách chung (không dùng cuid — không phải bí mật an toàn).
    const plain = input.password ?? (tempPassword = generateTempPassword());
    const passwordHash = await argon2.hash(plain);
    const created = await this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName,
        passwordHash,
        isSystemAdmin: input.isSystemAdmin ?? false,
        canCreateOrganization: input.canCreateOrganization ?? false,
      },
      select: USER_SELECT,
    });
    // Một vai trò "Quản trị": tạo tài khoản kèm Quản trị → cũng đặt vai trò tổ chức Quản trị (như bật ở Quản trị › Tài khoản).
    if (created.isSystemAdmin) {
      const res = await this.prisma.$transaction((tx) =>
        this.adminSync.setAdmin(tx, created.id, true),
      );
      await this.invalidateOrganizations(created.id, res.organizationIds);
    }
    // Tạo tài khoản (có thể là Quản trị) là thao tác giá trị cao → ghi nhật ký toàn hệ thống; không ghi mật khẩu.
    await this.audit.record({
      actorId,
      action: AUDIT_ACTIONS.ACCOUNT_CREATED,
      entityType: 'user',
      entityId: created.id,
      summary: `Tạo tài khoản ${created.displayName} (${created.email})${created.isSystemAdmin ? ' với quyền Quản trị' : ''}`,
      meta: {
        isSystemAdmin: created.isSystemAdmin,
        canCreateOrganization: created.canCreateOrganization,
      },
    });
    return { ...this.toDto(created), tempPassword };
  }

  async update(id: string, input: UpdateUserInput, actorId?: string) {
    const found = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        displayName: true,
        email: true,
        isSystemAdmin: true,
        canCreateOrganization: true,
      },
    });
    if (!found) throw new NotFoundAppException('Người dùng');
    // Khoá / mở khoá có tác dụng phụ (thu hồi phiên) và có thể bị từ chối → làm TRƯỚC, các trường còn lại sau.
    if (input.status && input.status !== found.status) {
      await this.setStatus(actorId, id, input.status);
    }
    // Đổi email đăng nhập: chặn tài khoản hệ thống và email đã thuộc người khác (unique trên User.email).
    const newEmail = input.email && input.email !== found.email ? input.email : undefined;
    if (newEmail) {
      if (found.email === SYSTEM_USER_EMAIL)
        throw new BusinessRuleException('Không đổi được email của tài khoản hệ thống');
      const taken = await this.prisma.user.findUnique({
        where: { email: newEmail },
        select: { id: true },
      });
      if (taken) throw new EmailAlreadyRegisteredException('Email này đã thuộc một tài khoản khác');
    }
    const data = {
      email: newEmail,
      displayName: input.displayName,
      canCreateOrganization: input.canCreateOrganization,
    };
    // Một vai trò "Quản trị": bật/tắt đổi CẢ cờ lẫn vai trò tổ chức trong cùng transaction (tắt người Quản trị cuối cùng — kể cả
    // tự tắt — bị chặn 422 ở `adminSync`).
    const toggling =
      input.isSystemAdmin !== undefined && input.isSystemAdmin !== found.isSystemAdmin;
    let touchedOrganizations: string[] = [];
    const updated = toggling
      ? await this.prisma.$transaction(async (tx) => {
          const res = await this.adminSync.setAdmin(tx, id, input.isSystemAdmin!);
          touchedOrganizations = res.organizationIds;
          return tx.user.update({ where: { id }, data, select: USER_SELECT });
        })
      : await this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
    await this.invalidateOrganizations(id, touchedOrganizations);
    // Bật/tắt admin hệ thống đổi phạm vi thấy dự án ở MỌI organization: gateway rà lại socket đang mở của người đó
    // (isSystemAdmin đọc trực tiếp từ DB, không có cache quyền để xoá).
    if (input.isSystemAdmin !== undefined && input.isSystemAdmin !== found.isSystemAdmin)
      this.events.emit(DOMAIN_EVENTS.ACCESS_CHANGED, { userIds: [id] });
    // Đổi quyền hệ thống (admin hệ thống / được lập tổ chức) — thao tác quản trị giá trị cao nhất.
    const permChanges: string[] = [];
    if (input.isSystemAdmin !== undefined && input.isSystemAdmin !== found.isSystemAdmin) {
      permChanges.push(input.isSystemAdmin ? 'cấp quyền Quản trị' : 'thu quyền Quản trị');
    }
    if (
      input.canCreateOrganization !== undefined &&
      input.canCreateOrganization !== found.canCreateOrganization
    ) {
      permChanges.push(
        input.canCreateOrganization ? 'cho phép lập tổ chức' : 'thu quyền lập tổ chức',
      );
    }
    if (newEmail) {
      await this.audit.record({
        actorId,
        action: AUDIT_ACTIONS.ACCOUNT_EMAIL_CHANGED,
        entityType: 'user',
        entityId: id,
        summary: `Đổi email đăng nhập của ${found.displayName}: ${found.email} → ${newEmail}`,
        meta: { from: found.email, to: newEmail },
      });
    }
    if (permChanges.length) {
      await this.audit.record({
        actorId,
        action: AUDIT_ACTIONS.ACCOUNT_PERMISSIONS_CHANGED,
        entityType: 'user',
        entityId: id,
        summary: `Với tài khoản ${found.displayName} (${found.email}): ${permChanges.join(', ')}`,
        meta: {
          isSystemAdmin: updated.isSystemAdmin,
          canCreateOrganization: updated.canCreateOrganization,
          ...(touchedOrganizations.length ? { organizationIds: touchedOrganizations } : {}),
        },
      });
    }
    return this.toDto(updated);
  }

  /**
   * Khoá / mở khoá tài khoản. Khoá = cùng một transaction: đổi status, đặt mốc `sessionsRevokedAt`
   * (access token còn hạn bị JwtStrategy từ chối ngay) và thu hồi mọi refresh token. Lịch sử công việc giữ nguyên.
   */
  async setStatus(actorId: string | undefined, id: string, status: 'ACTIVE' | 'DEACTIVATED') {
    const found = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, status: true, isSystemAdmin: true },
    });
    if (!found) throw new NotFoundAppException('Người dùng');
    if (found.status === status) return;
    const deactivate = status === 'DEACTIVATED';
    if (deactivate) {
      if (id === actorId) throw new BusinessRuleException('Bạn không thể vô hiệu hoá chính mình');
      if (found.email === SYSTEM_USER_EMAIL) {
        throw new BusinessRuleException('Không thể vô hiệu hoá tài khoản hệ thống của tự động hoá');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      if (deactivate && found.isSystemAdmin) await this.adminSync.assertNotLastAdmin(tx, id);
      await tx.user.update({
        where: { id },
        data: deactivate ? { status, sessionsRevokedAt: now } : { status },
      });
      if (deactivate) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        // Liên kết "quên mật khẩu" đã gửi trước đó không được dùng để lách khoá.
        await tx.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } });
      }
    });
    if (deactivate) {
      // API key của họ chặn NGAY (không đợi cache 60s) + ngắt socket đang mở. Key không bị thu hồi: mở khoá là dùng lại được.
      await this.apiKeys.dropCachesForUser(id);
      this.emitSessionsRevoked(id);
    }
    // Thao tác quản trị toàn hệ thống → organizationId null (xem ở /admin/system).
    await this.audit.record({
      actorId,
      organizationId: null,
      action: deactivate ? AUDIT_ACTIONS.ACCOUNT_DEACTIVATED : AUDIT_ACTIONS.ACCOUNT_REACTIVATED,
      entityType: 'user',
      entityId: id,
      summary: `${deactivate ? 'Khoá' : 'Mở khoá'} tài khoản ${found.displayName} (${found.email})`,
      meta: { from: found.status, to: status },
    });
  }

  /** Đặt mật khẩu tạm (hiện một lần cho admin) và đăng xuất mọi thiết bị của người đó. */
  async resetPassword(actorId: string | undefined, id: string) {
    const found = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, passwordHash: true },
    });
    if (!found) throw new NotFoundAppException('Người dùng');
    if (id === actorId) {
      throw new BusinessRuleException('Hãy đổi mật khẩu của chính bạn ở trang Tài khoản');
    }
    if (found.email === SYSTEM_USER_EMAIL || !found.passwordHash) {
      throw new BusinessRuleException('Tài khoản này không đăng nhập bằng mật khẩu');
    }
    const tempPassword = generateTempPassword();
    // Băm ngoài transaction để không giữ kết nối DB trong lúc argon2 chạy.
    const passwordHash = await argon2.hash(tempPassword);
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.update({ where: { id }, data: { passwordHash, sessionsRevokedAt: now } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      // Liên kết "quên mật khẩu" đang chờ phải chết: nếu không, ai giữ link cũ vẫn đặt được mật khẩu mới.
      await tx.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } });
    });
    this.emitSessionsRevoked(id);
    await this.audit.record({
      actorId,
      organizationId: null,
      action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_RESET,
      entityType: 'user',
      entityId: id,
      summary: `Đặt lại mật khẩu của ${found.displayName} (${found.email})`,
    });
    return { tempPassword };
  }

  /** Đăng xuất mọi thiết bị của một tài khoản (không đổi mật khẩu, không khoá). */
  async revokeSessions(actorId: string | undefined, id: string) {
    const found = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true },
    });
    if (!found) throw new NotFoundAppException('Người dùng');
    const revoked = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.update({ where: { id }, data: { sessionsRevokedAt: now } });
      const res = await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      return res.count;
    });
    this.emitSessionsRevoked(id);
    await this.audit.record({
      actorId,
      organizationId: null,
      action: AUDIT_ACTIONS.ACCOUNT_SESSIONS_REVOKED,
      entityType: 'user',
      entityId: id,
      summary: `Đăng xuất mọi thiết bị của ${found.displayName} (${found.email})`,
      meta: { revoked },
    });
    return { revoked };
  }

  /**
   * Thêm một tài khoản có sẵn vào tổ chức. Bỏ trống vai trò → "Organization Member". Người đã là thành viên
   * bị từ chối (tránh âm thầm ghi đè vai trò đang có — muốn đổi vai trò dùng trang Thành viên).
   */
  async addToOrganization(
    actorId: string | undefined,
    userId: string,
    input: AddToOrganizationInput,
  ) {
    const [user, ws] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, displayName: true },
      }),
      this.prisma.organization.findFirst({
        where: { id: input.organizationId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (!user) throw new NotFoundAppException('Người dùng');
    if (!ws) throw new NotFoundAppException('Tổ chức');
    const existing = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: ws.id, userId } },
      select: { id: true },
    });
    if (existing) {
      throw new BusinessRuleException(
        `${user.displayName} đã thuộc tổ chức ${ws.name} — đổi vai trò ở trang Thành viên của nơi đó`,
      );
    }
    let roleIds = input.roleIds ?? [];
    if (roleIds.length === 0) {
      const memberRole = await this.prisma.role.findFirst({
        where: {
          name: SYSTEM_ROLES.ORGANIZATION_MEMBER,
          scope: 'ORGANIZATION',
          organizationId: null,
          isSystem: true,
        },
        select: { id: true },
      });
      if (!memberRole) throw new NotFoundAppException('Vai trò Thành viên');
      roleIds = [memberRole.id];
    }
    const member = await this.members.addOrganization(ws.id, userId, roleIds, actorId);
    // Nhật ký toàn hệ thống (organizationId null); nhật ký của tổ chức đích đã có `member.added` từ MembersService.
    await this.audit.record({
      actorId,
      organizationId: null,
      action: AUDIT_ACTIONS.ACCOUNT_ORGANIZATION_ADDED,
      entityType: 'user',
      entityId: userId,
      summary: `Thêm ${user.displayName} (${user.email}) vào tổ chức ${ws.name}`,
      meta: { organizationId: ws.id, roleIds },
    });
    return member;
  }
}
