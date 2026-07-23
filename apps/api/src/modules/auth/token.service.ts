import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createId } from '@paralleldrive/cuid2';
import { ERROR_CODES } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  workspaceId: string | null;
  jti: string;
}

export interface RefreshMeta {
  userAgent?: string;
  ipAddress?: string;
}

/** Quản lý access JWT + refresh token rotation theo family (reuse detection). */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  signAccess(user: { id: string; email: string }, workspaceId: string | null) {
    const expiresIn = this.config.get<string>('jwt.accessExpiresIn') ?? '15m';
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email, workspaceId, jti: createId() } satisfies AccessTokenPayload,
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn },
    );
    return { accessToken, expiresIn: this.toSeconds(expiresIn) };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Tạo refresh token mới (opaque) trong 1 family; trả raw token để set cookie. */
  async issueRefresh(userId: string, family: string | null, meta: RefreshMeta): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    const fam = family ?? createId();
    const ttlMs = this.toSeconds(this.config.get<string>('jwt.refreshExpiresIn') ?? '7d') * 1000;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(raw),
        family: fam,
        expiresAt: new Date(Date.now() + ttlMs),
        userAgent: meta.userAgent?.slice(0, 255),
        ipAddress: meta.ipAddress,
      },
    });
    return `${fam}.${raw}`;
  }

  /** Xoay refresh: revoke cũ, cấp mới cùng family. Reuse (token đã revoke) => revoke cả family. */
  async rotateRefresh(token: string, meta: RefreshMeta): Promise<{ userId: string; newToken: string }> {
    const [, raw] = token.split('.', 2);
    if (!raw) throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Refresh token không hợp lệ' });
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashToken(raw) } });
    if (!row) throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Refresh token không tồn tại' });

    if (row.revokedAt || row.expiresAt < new Date()) {
      // Reuse detection: token đã bị thu hồi nhưng vẫn được dùng => revoke toàn family.
      await this.prisma.refreshToken.updateMany({
        where: { family: row.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Phiên đăng nhập đã hết hạn' });
    }

    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    const newToken = await this.issueRefresh(row.userId, row.family, meta);
    return { userId: row.userId, newToken };
  }

  async revokeFamilyByToken(token: string): Promise<void> {
    const [, raw] = token.split('.', 2);
    if (!raw) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashToken(raw) } });
    if (row) {
      await this.prisma.refreshToken.updateMany({
        where: { family: row.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  /** '15m' | '7d' | '3600' -> số giây. */
  private toSeconds(v: string): number {
    const m = /^(\d+)\s*([smhd])?$/.exec(v.trim());
    if (!m) return 900;
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    return n * mult;
  }
}
