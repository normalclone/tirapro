import { HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import type { UpdateProfileInput } from '@tirapro/shared';
import { ERROR_CODES, type PoolUserDto } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { insensitiveContains } from '../../common/like';
import { AppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { MediaService } from '../media/media.service';
import { SYSTEM_USER_EMAIL } from '../automation/rule-engine.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
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

  /** Thành viên của workspace (cho picker assignee/mention). */
  async listWorkspaceMembers(workspaceId: string, search?: string) {
    const members = await this.prisma.workspaceMembership.findMany({
      where: {
        workspaceId,
        user: search
          ? {
              OR: [
                { displayName: insensitiveContains(search) },
                { email: insensitiveContains(search) },
              ],
            }
          : undefined,
      },
      select: { user: true },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => this.toDto(m.user));
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
  async getById(workspaceId: string, id: string) {
    const m = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: id } },
      select: { user: true },
    });
    if (!m) throw new NotFoundAppException('Người dùng');
    return this.toDto(m.user);
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
