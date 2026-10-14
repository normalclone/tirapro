import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { EmailOutbox, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { withCronLock } from '../../common/cron-lock';
import { MAIL_PROVIDER, type MailProvider } from './mail.provider';
import { SENSITIVE_TEMPLATES, type MailTemplate } from './mail.service';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
/** Hàng SENDING quá lâu (process chết giữa chừng) được trả về PENDING. */
const STUCK_SENDING_MS = 10 * 60_000;
const REDACTED = '[Nội dung đã được xoá sau khi xử lý]';

/** Cron gửi thư trong outbox: lấy theo lô, gửi qua provider, thử lại có backoff luỹ thừa. */
@Injectable()
export class MailOutboxService implements OnApplicationShutdown {
  private readonly logger = new Logger(MailOutboxService.name);
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async runScheduled(): Promise<void> {
    // Khoá TTL 25s < chu kỳ 30s: node nào treo thì lượt sau node khác vẫn chạy được.
    await withCronLock(this.redis, 'mail-outbox', 25, async () => {
      await this.processBatch();
    }).catch((err: unknown) =>
      this.logger.warn(`Cron mail-outbox lỗi: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /** Xử lý một lô; trả số thư gửi thành công (phục vụ test). */
  async processBatch(now: Date = new Date()): Promise<number> {
    // Hàng SENDING treo = một lần gửi đã thất bại không rõ kết quả: tính là một lần thử, đủ 5 lần thì FAILED.
    const stuck = { status: 'SENDING' as const, scheduledAt: { lt: new Date(now.getTime() - STUCK_SENDING_MS) } };
    await this.prisma.emailOutbox.updateMany({
      where: { ...stuck, attempts: { gte: MAX_ATTEMPTS - 1 } },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: 'Treo ở trạng thái đang gửi quá lâu' },
    });
    await this.prisma.emailOutbox.updateMany({
      where: stuck,
      data: { status: 'PENDING', attempts: { increment: 1 } },
    });

    const rows = await this.prisma.emailOutbox.findMany({
      where: { status: 'PENDING', scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: BATCH_SIZE,
    });

    let sent = 0;
    for (const row of rows) {
      if (this.stopping) break;
      // "Giành" hàng bằng updateMany có điều kiện; scheduledAt lúc SENDING đóng vai thời điểm nhận việc.
      const claim = await this.prisma.emailOutbox.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'SENDING', scheduledAt: now },
      });
      if (claim.count !== 1) continue;
      if (await this.deliver(row, now)) sent++;
    }
    return sent;
  }

  private async deliver(row: EmailOutbox, now: Date): Promise<boolean> {
    try {
      await this.provider.send({ to: row.to, subject: row.subject, html: row.html, text: row.text });
    } catch (err) {
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      this.logger.warn(`Gửi thư ${row.id} (${row.template}) lỗi lần ${attempts}/${MAX_ATTEMPTS}: ${message}`);
      await this.prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: message,
          status: failed ? 'FAILED' : 'PENDING',
          // Backoff luỹ thừa: 2, 4, 8, 16 phút.
          scheduledAt: new Date(now.getTime() + 2 ** attempts * 60_000),
          ...(failed ? this.redaction(row.template) : {}),
        },
      });
      return false;
    }
    await this.prisma.emailOutbox.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null, ...this.redaction(row.template) },
    });
    return true;
  }

  /** Thư mời / đặt lại mật khẩu chứa token thô trong html/text/payload → xoá khi đã xong (chỉ còn sha256 ở bảng token). */
  private redaction(template: string): Pick<Prisma.EmailOutboxUpdateInput, 'html' | 'text' | 'payload'> {
    return SENSITIVE_TEMPLATES.includes(template as MailTemplate) ? { html: REDACTED, text: REDACTED, payload: {} } : {};
  }
}
