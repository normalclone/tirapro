import { describe, expect, it, vi } from 'vitest';
import { MailService } from './mail.service';
import { render as renderInvite } from './templates/invite';

function setup() {
  const emailOutbox = {
    create: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({})),
    findFirst: vi.fn((_args: unknown) => Promise.resolve(null as null | { id: string; payload: unknown })),
    updateMany: vi.fn((_args: unknown) => Promise.resolve({ count: 1 })),
  };
  const prisma = { emailOutbox };
  return { service: new MailService(prisma as never), emailOutbox };
}

const invitePayload = {
  workspaceName: 'Công ty <A>',
  inviterName: 'Minh',
  acceptUrl: 'http://localhost:5173/invite/accept?token=abc',
};

describe('MailService.enqueue', () => {
  it('ghi vào outbox đúng subject/html/text render từ template', async () => {
    const { service, emailOutbox } = setup();
    await service.enqueue({ to: 'a@x.vn', template: 'invite', payload: invitePayload });

    const expected = renderInvite(invitePayload);
    expect(emailOutbox.create).toHaveBeenCalledTimes(1);
    const data = emailOutbox.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      to: 'a@x.vn',
      template: 'invite',
      subject: expected.subject,
      html: expected.html,
      text: expected.text,
    });
    // HTML phải escape tên workspace, link nằm trong nút CTA và bản text.
    expect(expected.html).toContain('Công ty &lt;A&gt;');
    expect(expected.html).not.toContain('Công ty <A>');
    expect(expected.html).toContain(invitePayload.acceptUrl);
    expect(expected.text).toContain(invitePayload.acceptUrl);
  });

  it('dùng tx được truyền vào thay vì prisma gốc', async () => {
    const { service, emailOutbox } = setup();
    const tx = { emailOutbox: { create: vi.fn(() => Promise.resolve({})) } };
    await service.enqueue({ to: 'a@x.vn', template: 'password-reset', payload: { resetUrl: 'http://x/reset?token=t' } }, tx as never);
    expect(tx.emailOutbox.create).toHaveBeenCalledTimes(1);
    expect(emailOutbox.create).not.toHaveBeenCalled();
  });

  it('thông báo: lần đầu tạo hàng mới hẹn gửi sau 5 phút', async () => {
    const { service, emailOutbox } = setup();
    const before = Date.now();
    await service.enqueue({ to: 'a@x.vn', template: 'notification', payload: { title: 'T1', body: 'B1', url: 'http://x/1' } });
    const data = emailOutbox.create.mock.calls[0]![0].data as { scheduledAt: Date; payload: { items: unknown[] } };
    expect(data.scheduledAt.getTime() - before).toBeGreaterThanOrEqual(5 * 60_000 - 50);
    expect(data.payload.items).toHaveLength(1);
  });

  it('thông báo: đã có thư PENDING cho cùng người nhận → gộp vào payload.items, không tạo hàng mới', async () => {
    const { service, emailOutbox } = setup();
    emailOutbox.findFirst.mockResolvedValue({
      id: 'm1',
      payload: { items: [{ title: 'T1', body: 'B1', url: 'http://x/1' }] },
    });
    await service.enqueue({ to: 'a@x.vn', template: 'notification', payload: { title: 'T2', body: 'B2', url: 'http://x/2' } });
    expect(emailOutbox.create).not.toHaveBeenCalled();
    const args = emailOutbox.updateMany.mock.calls[0]![0] as { where: { id: string; status: string }; data: { subject: string; payload: { items: unknown[] } } };
    expect(args.where).toMatchObject({ id: 'm1', status: 'PENDING' });
    expect(args.data.payload.items).toHaveLength(2);
    expect(args.data.subject).toContain('2');
  });
});
