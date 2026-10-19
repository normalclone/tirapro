import { HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import type { UpdateProfileInput } from '@tirapro/shared';
import { ERROR_CODES, type MemberUserDto, type PoolUserDto } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { escapeLike, insensitiveContains } from '../../common/like';
import { memberUserForViewer } from '../../common/mappers/user.mapper';
import { normalizeVi, VI_TRANSLATE_FROM, VI_TRANSLATE_TO } from '../search/vi-text';
import { ProjectAccessService } from '../rbac/project-access.service';
import { AppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { MediaService } from '../media/media.service';
import { SYSTEM_USER_EMAIL } from '../automation/rule-engine.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly access: ProjectAccessService,
  ) {}

  private toDto(u: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    timezone: string;
    locale: string;
    status: string;
    isSystemAdmin: boolean;
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
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  /**
   * Thành viên của workspace (picker người phụ trách / @mention / bộ lọc). Lọc phía SERVER:
   * - mặc định loại tài khoản đã khoá (DEACTIVATED) và người dùng hệ thống automation; `includeInactive` giữ cả hai
   *   (màn bộ lọc theo người phụ trách cũ vẫn thấy tài khoản đã khoá);
   * - `projectId`: người gọi phải xem được dự án (404 như không tồn tại); chỉ trả người `canSee` dự án đó (cùng quyết định
   *   với `IssuesService.isAssignableMember` — không "giao việc rồi họ không mở được");
   * - `search` theo tên/email không phân biệt hoa thường VÀ dấu tiếng Việt ("nguyen" tìm "Nguyễn");
   * - `limit` (mặc định 50, tối đa 200) áp SAU lọc quyền xem dự án.
   * `isSystemAdmin`/`lastSeenAt` chỉ khi `privileged` (người xem có `member:manage`).
   */
  async listWorkspaceMembers(
    workspaceId: string,
    viewerId: string,
    q: { search?: string; projectId?: string; limit?: number; includeInactive?: boolean },
    privileged: boolean,
  ): Promise<MemberUserDto[]> {
    const limit = Math.min(Math.max(Math.trunc(q.limit ?? 50) || 50, 1), 200);
    if (q.projectId) await this.access.assertCanSee(viewerId, workspaceId, q.projectId);
    const search = q.search?.trim();
    const matchingIds = search ? await this.accentInsensitiveIds(workspaceId, search) : [];
    const where: Prisma.WorkspaceMembershipWhereInput = {
      workspaceId,
      user: {
        ...(q.includeInactive
          ? {}
          : { status: { not: 'DEACTIVATED' }, email: { not: SYSTEM_USER_EMAIL } }),
        ...(search
          ? {
              OR: [
                { displayName: insensitiveContains(search) },
                { email: insensitiveContains(search) },
                ...(matchingIds.length ? [{ id: { in: matchingIds } }] : []),
              ],
            }
          : {}),
      },
    };
    const orderBy = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
    const out: ReturnType<typeof this.toDto>[] = [];
    if (!q.projectId) {
      const rows = await this.prisma.workspaceMembership.findMany({
        where,
        select: { user: true },
        take: limit,
        orderBy,
      });
      for (const m of rows) out.push(this.toDto(m.user));
    } else {
      // Lọc quyền xem dự án sau truy vấn → lấy theo lô cho tới khi đủ `limit` hoặc hết người (chặn trên 10 lô).
      const batch = Math.min(limit * 2, 400);
      let cursor: string | undefined;
      for (let i = 0; i < 10 && out.length < limit; i++) {
        const rows = await this.prisma.workspaceMembership.findMany({
          where,
          select: { id: true, user: true },
          take: batch,
          orderBy,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const m of rows) {
          if (out.length >= limit) break;
          if (await this.access.canSee(m.user.id, workspaceId, q.projectId))
            out.push(this.toDto(m.user));
        }
        if (rows.length < batch) break;
        cursor = rows[rows.length - 1]!.id;
      }
    }
    return out.map((u) => memberUserForViewer(u, privileged));
  }

  /**
   * Id thành viên có tên khớp KHÔNG phân biệt dấu (bỏ dấu cả hai phía bằng `translate`, như tìm công việc). Chỉ bổ sung cho
   * so khớp `contains` có dấu của Prisma; lỗi truy vấn thì bỏ qua (vẫn còn so khớp có dấu).
   */
  private async accentInsensitiveIds(workspaceId: string, search: string): Promise<string[]> {
    const needle = normalizeVi(search);
    if (!needle) return [];
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT u."id" FROM "WorkspaceMembership" m JOIN "User" u ON u."id" = m."userId"
        WHERE m."workspaceId" = ${workspaceId}
          AND lower(translate(u."displayName", ${VI_TRANSLATE_FROM}, ${VI_TRANSLATE_TO})) LIKE ${`%${escapeLike(needle)}%`}
        LIMIT 500`;
      return rows.map((r) => r.id);
    } catch {
      return [];
    }
  }

  /**
   * Toàn bộ user hệ thống (pool chung) — cho picker "thêm thành viên". Loại tài khoản vô hiệu hoá và
   * người dùng hệ thống của automation (không phải người thật).
   */
  async listAllUsers(search?: string) {
    const eligible = {
      status: { not: 'DEACTIVATED' },
      email: { not: SYSTEM_USER_EMAIL },
    } as const;
    const users = await this.prisma.user.findMany({
      where: search
        ? {
            AND: [
              eligible,
              {
                OR: [
                  { displayName: insensitiveContains(search) },
                  { email: insensitiveContains(search) },
                ],
              },
            ],
          }
        : eligible,
      take: 100,
      orderBy: { displayName: 'asc' },
    });
    // Pool chung chỉ trả những trường picker cần — không lộ ai là admin hệ thống, lastSeenAt, múi giờ…
    return users.map(
      (u): PoolUserDto => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        status: u.status,
      }),
    );
  }

  /** Chỉ tra được người dùng cùng workspace — không lộ email/hồ sơ của user ngoài workspace. */
  async getById(workspaceId: string, id: string, privileged = false) {
    const m = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: id } },
      select: { user: true },
    });
    if (!m) throw new NotFoundAppException('Người dùng');
    return memberUserForViewer(this.toDto(m.user), privileged);
  }

  async updateProfile(id: string, data: UpdateProfileInput) {
    const u = await this.prisma.user.update({ where: { id }, data });
    return this.toDto(u);
  }

  /**
   * Đổi mật khẩu của chính mình: xác minh mật khẩu hiện tại (argon2), chặn đặt lại
   * trùng mật khẩu cũ, rồi cập nhật hash mới và thu hồi mọi phiên (xem bên dưới).
   */
  async changePassword(id: string, input: { currentPassword: string; newPassword: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.passwordHash) throw new NotFoundAppException('Người dùng');

    const ok = await argon2.verify(user.passwordHash, input.currentPassword);
    if (!ok) {
      throw new AppException(
        ERROR_CODES.VALIDATION_ERROR,
        'Mật khẩu hiện tại không đúng',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (await argon2.verify(user.passwordHash, input.newPassword)) {
      throw new AppException(
        ERROR_CODES.VALIDATION_ERROR,
        'Mật khẩu mới phải khác mật khẩu hiện tại',
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await argon2.hash(input.newPassword);
    // Đổi mật khẩu = đăng xuất mọi phiên khác: `sessionsRevokedAt` giết access token còn hạn, thu hồi mọi refresh token,
    // xoá link "quên mật khẩu" đang chờ. Phiên HIỆN TẠI cũng bị cắt → controller cấp phiên mới cho thiết bị này.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash, sessionsRevokedAt: now } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } });
    });
    // `revokedAtMs`: controller phát sự kiện ngắt socket CHỈ của token cấp trước mốc này (không ngắt thiết bị đang đổi).
    return { success: true, revokedAtMs: now.getTime() };
  }

  /** Đặt ảnh đại diện mới (xoá ảnh cũ best-effort). */
  async setAvatar(id: string, file: Express.Multer.File | undefined, req: Request) {
    const prev = await this.prisma.user.findUnique({ where: { id }, select: { avatarUrl: true } });
    if (!prev) throw new NotFoundAppException('Người dùng');
    const avatarUrl = await this.media.saveAvatar(file, 'user', req);
    const u = await this.prisma.user.update({ where: { id }, data: { avatarUrl } });
    await this.media.removeByUrl(prev.avatarUrl);
    return this.toDto(u);
  }

  /** Gỡ ảnh đại diện (về chữ-cái tự sinh). */
  async clearAvatar(id: string) {
    const prev = await this.prisma.user.findUnique({ where: { id }, select: { avatarUrl: true } });
    if (!prev) throw new NotFoundAppException('Người dùng');
    const u = await this.prisma.user.update({ where: { id }, data: { avatarUrl: null } });
    await this.media.removeByUrl(prev.avatarUrl);
    return this.toDto(u);
  }
}
