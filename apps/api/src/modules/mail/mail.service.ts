import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { render as renderInvite } from './templates/invite';
import { render as renderNotification, toItems } from './templates/notification';
import { render as renderPasswordReset } from './templates/password-reset';
import type { RenderedMail } from './templates/layout';

export type MailTemplate = 'invite' | 'password-reset' | 'notification';

export interface EnqueueInput {
  to: string;
  template: MailTemplate;
  payload: Record<string, unknown>;
}

const RENDERERS: Record<MailTemplate, (payload: Record<string, unknown>) => RenderedMail> = {
  invite: renderInvite,
  'password-reset': renderPasswordReset,
  notification: renderNotification,
};

/** Các template chứa liên kết dùng-một-lần: phải xoá nội dung khỏi outbox sau khi xử lý xong. */
export const SENSITIVE_TEMPLATES: readonly MailTemplate[] = ['invite', 'password-reset'];

/** Cửa sổ gộp (digest) cho thư thông báo. */
export const NOTIFICATION_DIGEST_WINDOW_MS = 5 * 60_000;
const DIGEST_CAS_RETRIES = 3;

@Injectable()
export class MailService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi thư vào outbox (trong `tx` nếu truyền) — KHÔNG gửi ngay; cron `MailOutboxService` gửi sau.
   * Thư thông báo được gộp: nếu người nhận còn một thư thông báo PENDING chưa tới giờ gửi thì nối vào đó.
   */
  async enqueue(input: EnqueueInput, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    if (input.template === 'notification') {
      await this.enqueueNotification(db, input);
      return;
    }
    const rendered = RENDERERS[input.template](input.payload);
    await db.emailOutbox.create({
      data: {
        to: input.to,
        template: input.template,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  private async enqueueNotification(db: Prisma.TransactionClient | PrismaService, input: EnqueueInput): Promise<void> {
    const newItems = toItems(input.payload);

    for (let attempt = 0; attempt < DIGEST_CAS_RETRIES; attempt++) {
      // Còn trong cửa sổ = chưa tới giờ gửi (scheduledAt > now) và chưa bị cron nhặt (PENDING).
      const pending = await db.emailOutbox.findFirst({
        where: { to: input.to, template: 'notification', status: 'PENDING', scheduledAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, payload: true },
      });
      if (!pending) break;

      const merged = { items: [...toItems((pending.payload ?? {}) as Record<string, unknown>), ...newItems] };
      const rendered = renderNotification(merged);
      // So sánh-và-ghi: chỉ ghi nếu payload chưa bị ai đổi và cron chưa nhặt hàng này; thua thì đọc lại thử tiếp.
      const { count } = await db.emailOutbox.updateMany({
        where: { id: pending.id, status: 'PENDING', payload: { equals: pending.payload as Prisma.InputJsonValue } },
        data: { payload: merged as unknown as Prisma.InputJsonValue, subject: rendered.subject, html: rendered.html, text: rendered.text },
      });
      if (count === 1) return;
    }

    const payload = { items: newItems };
    const rendered = renderNotification(payload);
    await db.emailOutbox.create({
      data: {
        to: input.to,
        template: 'notification',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        payload: payload as unknown as Prisma.InputJsonValue,
        scheduledAt: new Date(Date.now() + NOTIFICATION_DIGEST_WINDOW_MS),
      },
    });
  }
}
