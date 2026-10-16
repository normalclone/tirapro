import { describe, expect, it, vi } from 'vitest';
import { createDigestSchema, updateDigestSchema } from './digests.controller';
import { DigestsService } from './digests.service';

/** Người xem thấy mọi dự án (admin): visibleProjectIds = null, assertCanSee không ném. */
const ALL_ACCESS = {
  visibleProjectIds: vi.fn(() => Promise.resolve(null)),
  assertCanSee: vi.fn(() => Promise.resolve()),
};

function setup(
  resolution: { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' },
  integrationStatus: 'ACTIVE' | 'ERROR' | 'DISABLED' = 'ACTIVE',
) {
  const prisma = {
    project: { findMany: vi.fn(() => Promise.resolve([{ id: 'pPublic' }])) },
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
    ALL_ACCESS as never,
  );
  vi.spyOn(service, 'buildDigest').mockResolvedValue('tổng kết');
  return { service, prisma, telegram, integrations };
}

describe('DigestsService.run — token không dùng được', () => {
  it('unusable → 422, không gửi bằng bot toàn cục, đánh dấu tích hợp lỗi', async () => {
    const { service, telegram, integrations } = setup({ kind: 'unusable' });
    await expect(service.run('w1', 's1', 'u1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('không dùng được') as unknown,
    });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(integrations.reportUnusableToken).toHaveBeenCalledWith('g1');
  });

  it('tích hợp đã ERROR + token vẫn hỏng → run() vẫn ném 422 (không im lặng 200 sent:false)', async () => {
    const { service, telegram } = setup({ kind: 'unusable' }, 'ERROR');
    await expect(service.run('w1', 's1', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('tích hợp status khác ACTIVE/ERROR → sent:false, không đụng token', async () => {
    const { service, telegram } = setup({ kind: 'unusable' }, 'DISABLED');
    await expect(service.run('w1', 's1', 'u1')).resolves.toMatchObject({ sent: false });
    expect(telegram.resolveBotToken).not.toHaveBeenCalled();
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('tích hợp ERROR nhưng token dùng được → 422 gợi ý "Gửi thử", không gửi, không ghi lastRunAt', async () => {
    const { service, telegram, prisma } = setup({ kind: 'own', token: 'T' }, 'ERROR');
    await expect(service.run('w1', 's1', 'u1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('bấm Gửi thử') as unknown,
    });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(prisma.reportSubscription.update).not.toHaveBeenCalled();
  });

  it('sent:false (kênh tắt/không có) → không ghi lastRunAt; sent:true → ghi lastRunAt', async () => {
    const off = setup({ kind: 'global' }, 'DISABLED');
    await expect(off.service.run('w1', 's1', 'u1')).resolves.toMatchObject({ sent: false });
    expect(off.prisma.reportSubscription.update).not.toHaveBeenCalled();
    const ok = setup({ kind: 'global' });
    await expect(ok.service.run('w1', 's1', 'u1')).resolves.toMatchObject({ sent: true });
    expect(ok.prisma.reportSubscription.update).toHaveBeenCalledTimes(1);
  });

  it('global → gửi với token null', async () => {
    const { service, telegram } = setup({ kind: 'global' });
    await expect(service.run('w1', 's1', 'u1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith(null, 'c1', 'tổng kết');
  });

  it('own/global → gửi như cũ', async () => {
    const { service, telegram } = setup({ kind: 'own', token: 'T' });
    await expect(service.run('w1', 's1', 'u1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith('T', 'c1', 'tổng kết');
  });
});

describe('DigestsService — kênh phải thuộc workspace', () => {
  it('send(run) ràng workspaceId của subscription khi tra kênh', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    await service.run('w1', 's1', 'u1');
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
    await expect(service.update('w1', 's1', { channelId: 'khac-ws' }, 'u1')).rejects.toMatchObject({
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
    await expect(service.update('w1', 's1', { channelId: '' }, 'u1')).rejects.toMatchObject({
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
    await service.update('w1', 's1', { channelId: null }, 'u1');
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
    project: { findMany: vi.fn(() => Promise.resolve([{ id: 'pPublic' }])) },
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
    ALL_ACCESS as never,
  );
  const send = vi.spyOn(service as never, 'send' as never);
  if (opts.sendFails) send.mockRejectedValue(new Error('telegram down'));
  else send.mockResolvedValue({ sent: true, tokenUnusable: false, integrationError: false });
  vi.spyOn(service, 'buildDigest').mockResolvedValue('t');
  return { service, updateMany, send, prisma };
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
    const service = new DigestsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      ALL_ACCESS as never,
    );
    await service.buildDigest('w1');
    const arg = (m: { mock: { calls: unknown[][] } }) =>
      JSON.stringify((m.mock.calls[0] as unknown[])[0]);
    expect(arg(issueCount)).toContain('"project":{"deletedAt":null}');
    expect(arg(groupBy)).toContain('"project":{"deletedAt":null}');
    expect(arg(historyFind)).toContain('"project":{"deletedAt":null}');
    expect(arg(sprintFind)).toContain('"project":{"workspaceId":"w1","deletedAt":null}');
  });
});

describe('DigestsService — dự án riêng tư: người ngoài không thấy báo cáo định kỳ (P15)', () => {
  function privateSetup(visible: string[] | null) {
    const base = setup({ kind: 'global' });
    const access = {
      visibleProjectIds: vi.fn(() => Promise.resolve(visible)),
      assertCanSee: vi.fn((_u: string, _w: string, p: string, label?: string) =>
        visible === null || visible.includes(p)
          ? Promise.resolve()
          : Promise.reject(Object.assign(new Error(label), { status: 404 })),
      ),
    };
    const prisma = {
      ...base.prisma,
      reportSubscription: {
        ...base.prisma.reportSubscription,
        create: vi.fn((a: { data: unknown }) =>
          Promise.resolve({ id: 'new', ...(a.data as object) }),
        ),
        findMany: vi.fn(() => Promise.resolve([])),
        findFirst: vi.fn(() =>
          Promise.resolve({ id: 's1', workspaceId: 'w1', projectId: 'pHidden', channelId: 'ch1' }),
        ),
        delete: vi.fn(() => Promise.resolve({})),
      },
    };
    const service = new DigestsService(
      prisma as never,
      { resolveBotToken: () => ({ kind: 'global' }), send: () => Promise.resolve(true) } as never,
      {} as never,
      {} as never,
      access as never,
    );
    return { service, prisma, access };
  }

  it('list: người ngoài → OR [chung, dự án thấy được]; người thấy hết → không thêm điều kiện', async () => {
    const out = privateSetup(['pVisible']);
    await out.service.list('w1', undefined, 'u1');
    expect(out.prisma.reportSubscription.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', OR: [{ projectId: null }, { projectId: { in: ['pVisible'] } }] },
      orderBy: { createdAt: 'desc' },
    });
    const all = privateSetup(null);
    await all.service.list('w1', 'pX', 'u1');
    expect(all.prisma.reportSubscription.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', projectId: 'pX' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('update/remove/run báo cáo của dự án ẩn → 404 (không ghi, không gửi, không trả số liệu)', async () => {
    const { service, prisma } = privateSetup(['pVisible']);
    await expect(service.update('w1', 's1', { name: 'x' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.remove('w1', 's1', 'u1')).rejects.toMatchObject({ status: 404 });
    await expect(service.run('w1', 's1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(prisma.reportSubscription.update).not.toHaveBeenCalled();
    expect(prisma.reportSubscription.delete).not.toHaveBeenCalled();
  });

  it('thành viên dự án: run chạy được báo cáo của dự án đó', async () => {
    const { service } = privateSetup(['pHidden']);
    vi.spyOn(service, 'buildDigest').mockResolvedValue('ok');
    await expect(service.run('w1', 's1', 'u1')).resolves.toMatchObject({ summaryText: 'ok' });
  });

  it('run báo cáo cấp workspace bởi người không thấy hết: chỉ tính dự án thấy được', async () => {
    const { service, prisma } = privateSetup(['pVisible']);
    prisma.reportSubscription.findFirst.mockResolvedValueOnce({
      id: 's2',
      workspaceId: 'w1',
      projectId: null,
      channelId: null,
    } as never);
    const build = vi.spyOn(service, 'buildDigest').mockResolvedValue('t');
    await service.run('w1', 's2', 'u1');
    expect(build).toHaveBeenCalledWith('w1', undefined, ['pVisible']);
  });

  it('buildDigest với scopeProjectIds: mọi truy vấn giới hạn projectId in [...]', async () => {
    const issueCount = vi.fn(() => Promise.resolve(0));
    const groupBy = vi.fn(() => Promise.resolve([]));
    const historyFind = vi.fn(() => Promise.resolve([]));
    const sprintFind = vi.fn(() => Promise.resolve(null));
    const prisma = {
      issue: { count: issueCount, groupBy, aggregate: vi.fn() },
      issueHistory: { findMany: historyFind },
      sprint: { findFirst: sprintFind },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
    };
    const service = new DigestsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      ALL_ACCESS as never,
    );
    await service.buildDigest('w1', undefined, ['pA']);
    const arg = (m: { mock: { calls: unknown[][] } }) =>
      JSON.stringify((m.mock.calls[0] as unknown[])[0]);
    for (const m of [issueCount, groupBy, historyFind, sprintFind])
      expect(arg(m)).toContain('"projectId":{"in":["pA"]}');
  });
});

describe('DigestsService.create — dự án ẩn (P15 fix round 1)', () => {
  function createSetup(visible: string[] | null) {
    const out = (() => {
      const base = setup({ kind: 'global' });
      const access = {
        visibleProjectIds: vi.fn(() => Promise.resolve(visible)),
        assertCanSee: vi.fn((_u: string, _w: string, p: string) =>
          visible === null || visible.includes(p)
            ? Promise.resolve()
            : Promise.reject(Object.assign(new Error('Dự án'), { status: 404 })),
        ),
      };
      const create = vi.fn((a: { data: unknown }) =>
        Promise.resolve({ id: 'new', ...(a.data as object) }),
      );
      const prisma = {
        ...base.prisma,
        reportSubscription: { ...base.prisma.reportSubscription, create },
      };
      const service = new DigestsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        access as never,
      );
      return { service, create, access };
    })();
    return out;
  }

  it('người không thấy dự án → 404, KHÔNG tạo báo cáo', async () => {
    const { service, create } = createSetup(['pVisible']);
    await expect(
      service.create('w1', 'u1', { name: 'x', projectId: 'pHidden' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(create).not.toHaveBeenCalled();
  });

  it('người thấy dự án (thành viên/admin) → tạo được', async () => {
    const { service, create } = createSetup(['pHidden']);
    await expect(
      service.create('w1', 'u1', { name: 'x', projectId: 'pHidden' }),
    ).resolves.toMatchObject({ projectId: 'pHidden' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('báo cáo cấp workspace (không projectId): không cần kiểm dự án', async () => {
    const { service, create, access } = createSetup(['pVisible']);
    await service.create('w1', 'u1', { name: 'x' });
    expect(access.assertCanSee).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('DigestsService — digest cấp workspace ra kênh chỉ chứa dự án công khai (P15 fix round 1)', () => {
  it('run cấp workspace CÓ kênh: người bấm là admin thấy hết nhưng văn bản gửi ra chỉ dự án công khai', async () => {
    const { service, prisma } = setup({ kind: 'global' }); // sub: projectId null, channelId ch1; ALL_ACCESS = thấy hết
    const build = vi.spyOn(service, 'buildDigest').mockResolvedValue('t');
    await service.run('w1', 's1', 'admin');
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', deletedAt: null, isPrivate: false },
      select: { id: true },
    });
    expect(build).toHaveBeenCalledWith('w1', undefined, ['pPublic']);
  });

  it('run cấp dự án (admin chủ ý gắn dự án riêng tư): không thu hẹp, vẫn đúng dự án đó', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.reportSubscription.findFirst.mockResolvedValueOnce({
      id: 's3',
      workspaceId: 'w1',
      projectId: 'pPrivate',
      channelId: 'ch1',
    } as never);
    const build = vi.spyOn(service, 'buildDigest').mockResolvedValue('t');
    await service.run('w1', 's3', 'member');
    expect(build).toHaveBeenCalledWith('w1', 'pPrivate', undefined);
  });

  it('cron: cấp workspace → phạm vi = dự án công khai; cấp dự án → đúng dự án (không phạm vi)', async () => {
    const node = makeNode([
      { id: 'sWs', lastRunAt: null },
      { id: 'sPr', lastRunAt: null },
    ]);
    // sPr là báo cáo gắn dự án riêng tư
    (
      node.prisma.reportSubscription.findMany as unknown as {
        mockImplementation: (f: () => unknown) => void;
      }
    ).mockImplementation(() =>
      Promise.resolve([
        {
          id: 'sWs',
          lastRunAt: null,
          workspaceId: 'w1',
          projectId: null,
          channelId: 'c1',
          schedule: 'DAILY',
        },
        {
          id: 'sPr',
          lastRunAt: null,
          workspaceId: 'w1',
          projectId: 'pPrivate',
          channelId: 'c1',
          schedule: 'DAILY',
        },
      ]),
    );
    const build = vi.spyOn(node.service, 'buildDigest').mockResolvedValue('t');
    await node.service.runScheduled();
    expect(build).toHaveBeenCalledWith('w1', undefined, ['pPublic']);
    expect(build).toHaveBeenCalledWith('w1', 'pPrivate', undefined);
    expect(node.prisma.project.findMany).toHaveBeenCalledTimes(1); // gộp theo workspace
  });

  it('văn bản thật: dự án riêng tư (đếm, tên sprint, điểm còn lại) không lọt vào digest ra kênh', async () => {
    // Prisma giả tôn trọng điều kiện projectId.in: dữ liệu của pPrivate chỉ trả về nếu truy vấn KHÔNG giới hạn.
    const inScope = (where: { projectId?: { in: string[] } }, id: string) =>
      !where.projectId || where.projectId.in.includes(id);
    const prisma = {
      issue: {
        count: vi.fn((a: { where: { projectId?: { in: string[] } } }) =>
          Promise.resolve(inScope(a.where, 'pPrivate') ? 7 : 2),
        ),
        groupBy: vi.fn(() => Promise.resolve([])),
        aggregate: vi.fn(() => Promise.resolve({ _sum: { storyPoints: 13 } })),
      },
      issueHistory: { findMany: vi.fn(() => Promise.resolve([])) },
      sprint: {
        findFirst: vi.fn((a: { where: { projectId?: { in: string[] } } }) =>
          Promise.resolve(
            inScope(a.where, 'pPrivate') ? { id: 'sp', name: 'Sprint nhạy cảm HRX' } : null,
          ),
        ),
      },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
    };
    const service = new DigestsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      ALL_ACCESS as never,
    );
    const leaked = await service.buildDigest('w1'); // không phạm vi = hành vi cũ của cron
    expect(leaked).toContain('Sprint nhạy cảm HRX');
    const channelText = await service.buildDigest('w1', undefined, ['pPublic']);
    expect(channelText).not.toContain('Sprint nhạy cảm HRX');
    expect(channelText).toContain('Tạo mới (7 ngày): 2');
  });
});
