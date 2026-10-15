import { describe, expect, it, vi } from 'vitest';
import { MailOutboxService } from './mail-outbox.service';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    to: 'a@x.vn',
    subject: 's',
    html: '<p>h</p>',
    text: 't',
    template: 'invite',
    payload: {},
    status: 'PENDING',
    attempts: 0,
    ...over,
  };
}

function setup(rows: unknown[], sendImpl: () => Promise<void> = () => Promise.resolve()) {
  const emailOutbox = {
    updateMany: vi.fn((_a: unknown) => Promise.resolve({ count: 1 })),
    findMany: vi.fn((_a: unknown) => Promise.resolve(rows)),
    update: vi.fn((_a: unknown) => Promise.resolve({})),
  };
  const provider = { send: vi.fn(sendImpl) };
  const redis = { isAvailable: () => false, getClient: () => null };
  return {
    service: new MailOutboxService({ emailOutbox } as never, redis as never, provider),
    emailOutbox,
    provider,
  };
}

describe('MailOutboxService.processBatch', () => {
  it('gửi thành công → SENT, xoá nội dung nhạy cảm (token) khỏi outbox', async () => {
    const { service, emailOutbox, provider } = setup([row()]);
    const sent = await service.processBatch();
    expect(sent).toBe(1);
    expect(provider.send).toHaveBeenCalledWith({
      to: 'a@x.vn',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
    const upd = emailOutbox.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(upd.data).toMatchObject({ status: 'SENT', payload: {} });
    expect(upd.data.html).not.toContain('<p>h</p>');
  });

  it('thư thông báo thành công → giữ nguyên nội dung', async () => {
    const { service, emailOutbox } = setup([row({ template: 'notification' })]);
    await service.processBatch();
    const upd = emailOutbox.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(upd.data.status).toBe('SENT');
    expect('html' in upd.data).toBe(false);
  });

  it('lỗi → attempts+1, lastError, hẹn lại sau 2^attempts phút, vẫn PENDING', async () => {
    const now = new Date('2026-10-16T10:00:00Z');
    const { service, emailOutbox } = setup([row({ attempts: 1 })], () =>
      Promise.reject(new Error('smtp down')),
    );
    expect(await service.processBatch(now)).toBe(0);
    const upd = emailOutbox.update.mock.calls[0]![0] as {
      data: { attempts: number; lastError: string; status: string; scheduledAt: Date };
    };
    expect(upd.data).toMatchObject({ attempts: 2, lastError: 'smtp down', status: 'PENDING' });
    expect(upd.data.scheduledAt.getTime()).toBe(now.getTime() + 4 * 60_000);
  });

  it('lỗi lần thứ 5 → FAILED', async () => {
    const { service, emailOutbox } = setup([row({ attempts: 4 })], () =>
      Promise.reject(new Error('x')),
    );
    await service.processBatch();
    const upd = emailOutbox.update.mock.calls[0]![0] as { data: { status: string } };
    expect(upd.data.status).toBe('FAILED');
  });

  it('hàng SENDING treo → tăng attempts (đủ 5 lần thì FAILED)', async () => {
    const { service, emailOutbox } = setup([]);
    await service.processBatch();
    const [failed, retry] = emailOutbox.updateMany.mock.calls.map(
      (c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> },
    );
    expect(failed!.where).toMatchObject({ status: 'SENDING', attempts: { gte: 4 } });
    expect(failed!.data).toMatchObject({ status: 'FAILED', attempts: { increment: 1 } });
    expect(retry!.data).toMatchObject({ status: 'PENDING', attempts: { increment: 1 } });
  });

  it('node khác đã giành hàng (updateMany count=0) → bỏ qua, không gửi', async () => {
    const { service, emailOutbox, provider } = setup([row()]);
    emailOutbox.updateMany.mockResolvedValueOnce({ count: 0 }); // khôi phục SENDING treo → FAILED
    emailOutbox.updateMany.mockResolvedValueOnce({ count: 0 }); // khôi phục SENDING treo → PENDING
    emailOutbox.updateMany.mockResolvedValueOnce({ count: 0 }); // giành hàng
    expect(await service.processBatch()).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
  });
});
