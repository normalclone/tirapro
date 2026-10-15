import { describe, expect, it, vi } from 'vitest';
import { createDigestSchema, updateDigestSchema } from './digests.controller';
import { DigestsService } from './digests.service';

function setup(
  resolution: { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' },
  integrationStatus: 'ACTIVE' | 'ERROR' | 'DISABLED' = 'ACTIVE',
) {
  const prisma = {
    reportSubscription: {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 's1', workspaceId: 'w1', projectId: null, channelId: 'ch1' }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    integrationChannel: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          externalId: 'c1',
          integration: {
            id: 'g1',
            type: 'TELEGRAM',
            status: integrationStatus,
            config: { botToken: 'x' },
          },
        }),
      ),
    },
  };
  const telegram = {
    resolveBotToken: vi.fn(() => resolution),
    send: vi.fn(() => Promise.resolve(true)),
  };
  const integrations = { reportUnusableToken: vi.fn(() => Promise.resolve()) };
  const service = new DigestsService(
    prisma as never,
    telegram as never,
    {} as never,
    integrations as never,
  );
  vi.spyOn(service, 'buildDigest').mockResolvedValue('tổng kết');
  return { service, prisma, telegram, integrations };
}

describe('DigestsService.run — token không dùng được', () => {
  it('unusable → 422, không gửi bằng bot toàn cục, đánh dấu tích hợp lỗi', async () => {
    const { service, telegram, integrations } = setup({ kind: 'unusable' });
    await expect(service.run('w1', 's1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('không dùng được') as unknown,
    });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(integrations.reportUnusableToken).toHaveBeenCalledWith('g1');
  });

  it('tích hợp đã ERROR + token vẫn hỏng → run() vẫn ném 422 (không im lặng 200 sent:false)', async () => {
    const { service, telegram } = setup({ kind: 'unusable' }, 'ERROR');
    await expect(service.run('w1', 's1')).rejects.toMatchObject({ status: 422 });
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('tích hợp status khác ACTIVE/ERROR → sent:false, không đụng token', async () => {
    const { service, telegram } = setup({ kind: 'unusable' }, 'DISABLED');
    await expect(service.run('w1', 's1')).resolves.toMatchObject({ sent: false });
    expect(telegram.resolveBotToken).not.toHaveBeenCalled();
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('tích hợp ERROR nhưng token dùng được → 422 gợi ý "Gửi thử", không gửi, không ghi lastRunAt', async () => {
    const { service, telegram, prisma } = setup({ kind: 'own', token: 'T' }, 'ERROR');
    await expect(service.run('w1', 's1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('bấm Gửi thử') as unknown,
    });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(prisma.reportSubscription.update).not.toHaveBeenCalled();
  });

  it('sent:false (kênh tắt/không có) → không ghi lastRunAt; sent:true → ghi lastRunAt', async () => {
    const off = setup({ kind: 'global' }, 'DISABLED');
    await expect(off.service.run('w1', 's1')).resolves.toMatchObject({ sent: false });
    expect(off.prisma.reportSubscription.update).not.toHaveBeenCalled();
    const ok = setup({ kind: 'global' });
    await expect(ok.service.run('w1', 's1')).resolves.toMatchObject({ sent: true });
    expect(ok.prisma.reportSubscription.update).toHaveBeenCalledTimes(1);
  });

  it('global → gửi với token null', async () => {
    const { service, telegram } = setup({ kind: 'global' });
    await expect(service.run('w1', 's1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith(null, 'c1', 'tổng kết');
  });

  it('own/global → gửi như cũ', async () => {
    const { service, telegram } = setup({ kind: 'own', token: 'T' });
    await expect(service.run('w1', 's1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith('T', 'c1', 'tổng kết');
  });
});

describe('DigestsService — kênh phải thuộc workspace', () => {
  it('send(run) ràng workspaceId của subscription khi tra kênh', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    await service.run('w1', 's1');
    expect(prisma.integrationChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'ch1',
          workspaceId: 'w1',
          isEnabled: true,
        }) as unknown,
      }),
    );
  });

  it('create với channelId của workspace khác -> 404, không ghi', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.integrationChannel.findFirst.mockResolvedValueOnce(null as never);
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    await expect(
      service.create('w1', 'u1', { name: 'n', channelId: 'khac-ws' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.integrationChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'khac-ws', workspaceId: 'w1' } }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('update channelId của workspace khác -> 404, không ghi', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.integrationChannel.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.update('w1', 's1', { channelId: 'khac-ws' })).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.reportSubscription.update).not.toHaveBeenCalled();
  });

  it('channelId chuỗi rỗng bị từ chối ở create/update (không lưu "")', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.integrationChannel.findFirst.mockResolvedValue(null as never);
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    await expect(service.create('w1', 'u1', { name: 'n', channelId: '' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.update('w1', 's1', { channelId: '' })).rejects.toMatchObject({
      status: 404,
    });
    expect(create).not.toHaveBeenCalled();
    expect(prisma.reportSubscription.update).not.toHaveBeenCalled();
  });

  it('schema controller từ chối channelId rỗng', () => {
    expect(createDigestSchema.safeParse({ name: 'n', channelId: '' }).success).toBe(false);
    expect(updateDigestSchema.safeParse({ channelId: '' }).success).toBe(false);
    expect(updateDigestSchema.safeParse({ channelId: null }).success).toBe(true);
    expect(createDigestSchema.safeParse({ name: 'n' }).success).toBe(true);
  });

  it('update channelId null (gỡ kênh) không tra kênh', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    await service.update('w1', 's1', { channelId: null });
    expect(prisma.integrationChannel.findFirst).not.toHaveBeenCalled();
    expect(prisma.reportSubscription.update).toHaveBeenCalledTimes(1);
  });
});

type SubRow = { id: string; lastRunAt: Date | null };

/** Prisma giả có CAS thật trên một "bảng" dùng chung — mô phỏng hai node cùng một DB. */
function makeNode(
  table: SubRow[],
  opts: { sendFails?: boolean; snapshotLastRunAt?: Date | null } = {},
) {
  const updateMany = vi.fn(
    (args: { where: { id: string; lastRunAt: Date | null }; data: { lastRunAt: Date | null } }) => {
      const row = table.find((r) => r.id === args.where.id);
      const cur = row?.lastRunAt?.getTime() ?? null;
      const want = args.where.lastRunAt?.getTime() ?? null;
      if (!row || cur !== want) return Promise.resolve({ count: 0 });
      row.lastRunAt = args.data.lastRunAt;
      return Promise.resolve({ count: 1 });
    },
  );
  const prisma = {
    reportSubscription: {
      // Snapshot tại thời điểm đọc (như SELECT): hai node đọc cùng lastRunAt cũ.
      findMany: vi.fn(() =>
        Promise.resolve(
          table.map((s) => ({
            ...s,
            ...(opts.snapshotLastRunAt !== undefined ? { lastRunAt: opts.snapshotLastRunAt } : {}),
            workspaceId: 'w1',
            projectId: null,
            channelId: 'c1',
            schedule: 'DAILY',
          })),
        ),
      ),
      updateMany,
    },
  };
  const service = new DigestsService(
    prisma as never,
    {} as never,
    { isAvailable: () => false, getClient: () => null } as never,
    {} as never,
  );
  const send = vi.spyOn(service as never, 'send' as never);
  if (opts.sendFails) send.mockRejectedValue(new Error('telegram down'));
  else send.mockResolvedValue({ sent: true, tokenUnusable: false, integrationError: false });
  vi.spyOn(service, 'buildDigest').mockResolvedValue('t');
  return { service, updateMany, send };
}

describe('DigestsService.runScheduled — chống gửi đôi (CAS lastRunAt)', () => {
  it('sub vừa chạy < 30 phút trước (node khác nhanh hơn) => không gửi lại', async () => {
    const { service, send, updateMany } = makeNode([
      { id: 's1', lastRunAt: new Date(Date.now() - 60_000) },
    ]);
    await service.runScheduled();
    expect(send).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('CAS thua (node khác claim giữa lúc đọc và ghi) => không gửi', async () => {
    const prev = new Date('2026-10-14T01:00:00Z');
    // Bảng đã bị node khác claim; node này vẫn cầm snapshot cũ `prev`.
    const table: SubRow[] = [{ id: 's1', lastRunAt: new Date(prev.getTime() + 1) }];
    const { service, send, updateMany } = makeNode(table, { snapshotLastRunAt: prev });
    await service.runScheduled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 's1', lastRunAt: prev },
      data: { lastRunAt: expect.any(Date) as unknown },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('claim thành công => gửi đúng một lần; lastRunAt đã được đặt TRƯỚC khi gửi', async () => {
    const { service, send, updateMany } = makeNode([{ id: 's1', lastRunAt: null }]);
    await service.runScheduled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('w1', 'c1', 't'); // ràng workspaceId của subscription
    expect(updateMany.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!);
  });

  it('gửi ném lỗi => hoàn lastRunAt về giá trị cũ', async () => {
    const prev = new Date('2026-10-14T01:00:00Z');
    const table: SubRow[] = [{ id: 's1', lastRunAt: prev }];
    const { service, send, updateMany } = makeNode(table, { sendFails: true });
    await service.runScheduled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 's1', lastRunAt: expect.any(Date) as unknown },
      data: { lastRunAt: prev },
    });
    expect(table[0]!.lastRunAt).toEqual(prev);
  });

  it('hai node chạy ĐỒNG THỜI cùng đọc lastRunAt cũ => chỉ một node gửi', async () => {
    const table: SubRow[] = [
      { id: 's1', lastRunAt: new Date('2026-10-14T01:00:00Z') },
      { id: 's2', lastRunAt: null },
    ];
    const a = makeNode(table);
    const b = makeNode(table);
    await Promise.all([a.service.runScheduled(), b.service.runScheduled()]);
    expect(a.send.mock.calls.length + b.send.mock.calls.length).toBe(2); // mỗi sub đúng một lần
  });

  it('node B chạy sau khi node A đã xong (khoá cron đã nhả, đồng hồ lệch) => không gửi lại', async () => {
    const table: SubRow[] = [{ id: 's1', lastRunAt: null }];
    const a = makeNode(table);
    const b = makeNode(table);
    await a.service.runScheduled();
    await b.service.runScheduled();
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).not.toHaveBeenCalled();
  });
});

describe('DigestsService.buildDigest — bỏ qua dự án đã xoá mềm (I3)', () => {
  it('mọi truy vấn issue/sprint/history đều lọc project.deletedAt = null', async () => {
    const issueCount = vi.fn(() => Promise.resolve(1));
    const groupBy = vi.fn(() => Promise.resolve([]));
    const aggregate = vi.fn(() => Promise.resolve({ _sum: { storyPoints: 3 } }));
    const historyFind = vi.fn(() => Promise.resolve([]));
    const sprintFind = vi.fn(() => Promise.resolve({ id: 'sp1', name: 'S1' }));
    const prisma = {
      issue: { count: issueCount, groupBy, aggregate },
      issueHistory: { findMany: historyFind },
      sprint: { findFirst: sprintFind },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
    };
    const service = new DigestsService(prisma as never, {} as never, {} as never, {} as never);
    await service.buildDigest('w1');
    const arg = (m: { mock: { calls: unknown[][] } }) =>
      JSON.stringify((m.mock.calls[0] as unknown[])[0]);
    expect(arg(issueCount)).toContain('"project":{"deletedAt":null}');
    expect(arg(groupBy)).toContain('"project":{"deletedAt":null}');
    expect(arg(historyFind)).toContain('"project":{"deletedAt":null}');
    expect(arg(sprintFind)).toContain('"project":{"workspaceId":"w1","deletedAt":null}');
  });
});
