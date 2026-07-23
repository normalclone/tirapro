import { HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import { ERROR_CODES } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { MediaService } from '../media/media.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  private toDto(u: {
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

  /** Thành viên của workspace (cho picker assignee/mention). */
  async listWorkspaceMembers(workspaceId: string, search?: string) {
    const members = await this.prisma.workspaceMembership.findMany({
      where: {
        workspaceId,
        user: search
          ? { OR: [{ displayName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
          : undefined,
      },
      select: { user: true },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => this.toDto(m.user));
  }

  /** Toàn bộ user hệ thống (pool) — cho picker "thêm thành viên". */
  async listAllUsers(search?: string) {
    const users = await this.prisma.user.findMany({
      where: search
        ? { OR: [{ displayName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
        : undefined,
      take: 100,
      orderBy: { displayName: 'asc' },
    });
    return users.map((u) => this.toDto(u));
  }

  async getById(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundAppException('Người dùng');
    return this.toDto(u);
  }

  async updateProfile(id: string, data: { displayName?: string; avatarUrl?: string; timezone?: string; locale?: string }) {
    const u = await this.prisma.user.update({ where: { id }, data });
    return this.toDto(u);
  }

  /**
   * Đổi mật khẩu của chính mình: xác minh mật khẩu hiện tại (argon2), chặn đặt lại
   * trùng mật khẩu cũ, rồi cập nhật hash mới. Không động tới refresh token hiện có.
   */
  async changePassword(id: string, input: { currentPassword: string; newPassword: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.passwordHash) throw new NotFoundAppException('Người dùng');

    const ok = await argon2.verify(user.passwordHash, input.currentPassword);
    if (!ok) {
      throw new AppException(ERROR_CODES.VALIDATION_ERROR, 'Mật khẩu hiện tại không đúng', HttpStatus.BAD_REQUEST);
    }
    if (await argon2.verify(user.passwordHash, input.newPassword)) {
      throw new AppException(ERROR_CODES.VALIDATION_ERROR, 'Mật khẩu mới phải khác mật khẩu hiện tại', HttpStatus.BAD_REQUEST);
    }

    const passwordHash = await argon2.hash(input.newPassword);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { success: true };
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
