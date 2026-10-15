import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AUDIT_ACTIONS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { offsetPage } from '../../common/dto/page-result';
import { generateTempPassword } from '../../common/password';
import { AuditService } from '../audit/audit.service';
import { SYSTEM_USER_EMAIL } from '../automation/rule-engine.service';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './admin.schemas';

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  isSystemAdmin: true,
  canCreateWorkspace: true,
  lastSeenAt: true,
  createdAt: true,
  _count: { select: { workspaceMemberships: true } },
} as const;

type Row = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  isSystemAdmin: boolean;
  canCreateWorkspace: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  _count: { workspaceMemberships: number };
};

/** Quản trị tài khoản toàn hệ thống (chỉ admin hệ thống). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toDto(u: Row) {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      status: u.status,
      isSystemAdmin: u.isSystemAdmin,
      canCreateWorkspace: u.canCreateWorkspace,
      workspaceCount: u._count.workspaceMemberships,
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

    // Tạo tài khoản bởi admin hệ thống có thể trả mật khẩu tạm; để thêm người vào workspace dùng POST /members (người có sẵn) hoặc POST /members/accounts (tạo mới).
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
        canCreateWorkspace: input.canCreateWorkspace ?? false,
      },
      select: USER_SELECT,
    });
    // Tạo tài khoản (có thể là admin hệ thống) là thao tác giá trị cao → ghi nhật ký toàn hệ thống; không ghi mật khẩu.
    await this.audit.record({
      actorId,
      action: AUDIT_ACTIONS.ACCOUNT_CREATED,
      entityType: 'user',
      entityId: created.id,
      summary: `Tạo tài khoản ${created.displayName} (${created.email})${created.isSystemAdmin ? ' với quyền admin hệ thống' : ''}`,
      meta: {
        isSystemAdmin: created.isSystemAdmin,
        canCreateWorkspace: created.canCreateWorkspace,
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
        canCreateWorkspace: true,
      },
    });
    if (!found) throw new NotFoundAppException('Người dùng');
    // Khoá / mở khoá có tác dụng phụ (thu hồi phiên) và có thể bị từ chối → làm TRƯỚC, các trường còn lại sau.
    if (input.status && input.status !== found.status) {
      await this.setStatus(actorId, id, input.status);
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        displayName: input.displayName,
        isSystemAdmin: input.isSystemAdmin,
        canCreateWorkspace: input.canCreateWorkspace,
      },
      select: USER_SELECT,
    });
    // Đổi quyền hệ thống (admin hệ thống / được lập workspace) — thao tác quản trị giá trị cao nhất.
    const permChanges: string[] = [];
    if (input.isSystemAdmin !== undefined && input.isSystemAdmin !== found.isSystemAdmin) {
      permChanges.push(
        input.isSystemAdmin ? 'cấp quyền admin hệ thống' : 'thu quyền admin hệ thống',
      );
    }
    if (
      input.canCreateWorkspace !== undefined &&
      input.canCreateWorkspace !== found.canCreateWorkspace
    ) {
      permChanges.push(
        input.canCreateWorkspace
          ? 'cho phép lập không gian làm việc'
          : 'thu quyền lập không gian làm việc',
      );
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
          canCreateWorkspace: updated.canCreateWorkspace,
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
      if (found.isSystemAdmin) {
        const activeAdmins = await this.prisma.user.count({
          where: { isSystemAdmin: true, status: 'ACTIVE' },
        });
        if (activeAdmins <= 1) {
          throw new BusinessRuleException('Không thể vô hiệu hoá admin hệ thống cuối cùng');
        }
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.update({
        where: { id },
        data: deactivate ? { status, sessionsRevokedAt: now } : { status },
      });
      if (deactivate) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
      }
    });
    // Thao tác quản trị toàn hệ thống → workspaceId null (xem ở /admin/system).
    await this.audit.record({
      actorId,
      workspaceId: null,
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
    });
    await this.audit.record({
      actorId,
      workspaceId: null,
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
    await this.audit.record({
      actorId,
      workspaceId: null,
      action: AUDIT_ACTIONS.ACCOUNT_SESSIONS_REVOKED,
      entityType: 'user',
      entityId: id,
      summary: `Đăng xuất mọi thiết bị của ${found.displayName} (${found.email})`,
      meta: { revoked },
    });
    return { revoked };
  }
}
