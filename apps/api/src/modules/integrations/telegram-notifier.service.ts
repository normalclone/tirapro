import { Injectable, Logger } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TelegramService } from './telegram.service';

/**
 * Gửi thông báo cá nhân qua Telegram (chat riêng đã liên kết). KHÔNG BAO GIỜ ném lỗi — thông báo in-app/email không được
 * vì Telegram mà hỏng. Nội dung (HTML đã escape) do bên gọi dựng.
 */
@Injectable()
export class TelegramNotifier {
  private readonly logger = new Logger(TelegramNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  /** `true` khi tin đã tới Telegram. Không có liên kết / bot hỏng / lỗi gửi → `false`. */
  async send(userId: string, organizationId: string, html: string): Promise<boolean> {
    try {
      const link = await this.prisma.userTelegramLink.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        include: { integration: { select: { id: true, config: true, status: true } } },
      });
      if (!link || link.integration.status !== IntegrationStatus.ACTIVE) return false;
      const res = this.telegram.resolveBotToken(link.integration.config);
      if (res.kind === 'unusable') return false;
      if (res.kind === 'global' && !this.telegram.available()) return false;
      const outcome = await this.telegram.sendDetailed(
        res.kind === 'own' ? res.token : null,
        link.chatId,
        html,
      );
      if (outcome === 'blocked') {
        // Người dùng chặn/xoá bot: bỏ liên kết để không gửi lại mãi (họ liên kết lại được trong Cài đặt).
        await this.prisma.userTelegramLink.deleteMany({ where: { id: link.id } });
        this.logger.warn(
          `Telegram cá nhân: chat của người dùng ${userId} không còn nhận được tin — đã bỏ liên kết`,
        );
      }
      return outcome === 'ok';
    } catch (err) {
      this.logger.warn(
        `Telegram cá nhân: gửi thất bại — ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
