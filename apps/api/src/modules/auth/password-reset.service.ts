import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@tirapro/types';
import * as argon2 from 'argon2';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { MailService } from '../mail/mail.service';
import { SYSTEM_USER_EMAIL } from '../automation/rule-engine.service';
import { generateOneTimeToken, hashOneTimeToken } from './auth-token';

const PASSWORD_RESET_TTL_MS = 60 * 60_000;
/** Mỗi tài khoản tối đa một thư đặt lại mỗi 60 giây — không để người lạ bom hộp thư của người khác. */
const RESEND_COOLDOWN_MS = 60_000;

const INVALID_LINK =
  'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã được dùng — hãy yêu cầu liên kết mới';
const EXPIRED_LINK = 'Liên kết đặt lại mật khẩu đã hết hạn — hãy yêu cầu liên kết mới';

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Luôn resolve, kể cả khi email không tồn tại / bị khoá / vừa yêu cầu — không lộ email nào có tài khoản.
   * Token cũ chưa dùng bị vô hiệu: mỗi tài khoản chỉ có một liên kết còn hiệu lực.
   */
  async requestReset(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    // Người dùng hệ thống của automation không có mật khẩu và không phải người thật — không bao giờ cấp liên kết đặt lại.
    if (email === SYSTEM_USER_EMAIL) return;
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true, status: true },
    });
    if (!user || user.status === 'DEACTIVATED') return;

    const recent = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) return;

    const { token, tokenHash } = generateOneTimeToken();
    const base = this.config.get<string>('mail.appWebUrl') ?? '';
    const resetUrl = `${base}/reset-password?token=${token}`;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        },
      });
      await this.mail.enqueue(
        {
          to: user.email,
          template: 'password-reset',
          payload: { displayName: user.displayName, resetUrl },
        },
        tx,
      );
    });
  }

  /** Đặt mật khẩu mới bằng token: dùng một lần, còn hạn; xong thì đăng xuất mọi phiên của user. */
  async resetPassword(input: { token: string; newPassword: string }): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashOneTimeToken(input.token) },
    });
    if (!row || row.usedAt) throw new BusinessRuleException(INVALID_LINK);
    if (row.expiresAt.getTime() <= Date.now()) throw new BusinessRuleException(EXPIRED_LINK);

    // Băm ngoài transaction để không giữ kết nối DB trong lúc argon2 chạy.
    const passwordHash = await argon2.hash(input.newPassword);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // "Giành" token bằng một câu update có điều kiện: hai request đồng thời chỉ một request thắng.
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claim.count !== 1) throw new BusinessRuleException(INVALID_LINK);

      // `sessionsRevokedAt`: access token còn hạn của mật khẩu cũ chết ngay (không đợi hết 15 phút).
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash, sessionsRevokedAt: now },
      });
      // Đổi mật khẩu = thu hồi mọi refresh token (mọi family) của user.
      await tx.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    // Ngắt socket đang mở của mật khẩu cũ (kể cả node khác qua Redis adapter).
    this.events.emit(DOMAIN_EVENTS.ACCOUNT_SESSIONS_REVOKED, { userId: row.userId });
  }
}
