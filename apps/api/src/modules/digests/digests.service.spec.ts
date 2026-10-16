import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DigestModel } from '@tirapro/shared';
import { PUBLIC_VIEWER } from '../rbac/project-access.service';
import { createDigestSchema, previewDigestSchema, updateDigestSchema } from './digests.controller';
import { DigestsService } from './digests.service';

const MODEL: DigestModel = {
  title: 'Tổng kết tuần',
  subtitle: '',
  sections: [{ id: 'summary', title: 'Tổng kết tuần', lines: ['tổng kết'] }],
};

/** Phụ thuộc phân tích/quyền cho digest — mặc định "người xem thấy tất cả". */
function extras(visible: object = {}) {
  const access = {
    visibleWhere: vi.fn(() => Promise.resolve(visible)),
    visibleProjectIds: vi.fn(() => Promise.resolve(null)),
    assertCanSee: vi.fn(() => Promise.resolve()),
    canSee: vi.fn((..._a: unknown[]) => Promise.resolve(true)),
  };
  const leadership = {
    get: vi.fn(() =>
      Promise.resolve({ topRisks: [], slowGoals: [], overloaded: [], unavailable: [] }),
    ),
  };
  const health = { forProjects: vi.fn(() => Promise.resolve(new Map())) };
  const mail = { enqueue: vi.fn(() => Promise.resolve()) };
  const config = { get: vi.fn(() => 'http://app.test') };
  return { access, leadership, health, mail, config };
}

function setup(
  resolution: { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' },
  integrationStatus: 'ACTIVE' | 'ERROR' | 'DISABLED' = 'ACTIVE',
) {
  const prisma = {
    reportSubscription: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 's1',
          workspaceId: 'w1',
          projectId: null,
          channelId: 'ch1',
          metrics: [],
          createdById: 'u1',
          deliverEmail: false,
          allowPrivateToChannel: false,
          lastRunAt: null as Date | null,
          recipients: [] as string[],
        }),
      ),
      update: vi.fn(() => Promise.resolve({})),
      updateMany: vi.fn((..._a: unknown[]) => Promise.resolve({ count: 1 })),
    },
    project: {
      findFirst: vi.fn((..._a: unknown[]) => Promise.resolve({ isPrivate: false } as unknown)),
    },
    user: {
      findMany: vi.fn(() => Promise.resolve([] as unknown[])),
      findUnique: vi.fn(() => Promise.resolve({ displayName: 'Lan' })),
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
  const ex = extras();
  const service = new DigestsService(
    prisma as never,
    telegram as never,
    {} as never,
    integrations as never,
    ex.access as never,
    ex.leadership as never,
    ex.health as never,
    ex.mail as never,
    ex.config as never,
  );
  vi.spyOn(service, 'buildDigest').mockResolvedValue(MODEL);
  return { service, prisma, telegram, integrations, ...ex };
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
    expect(telegram.send).toHaveBeenCalledWith(null, 'c1', expect.stringContaining('tổng kết'));
  });

  it('own/global → gửi như cũ', async () => {
    const { service, telegram } = setup({ kind: 'own', token: 'T' });
    await expect(service.run('w1', 's1', 'u1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith('T', 'c1', expect.stringContaining('tổng kết'));
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
  opts: {
    sendFails?: boolean;
    snapshotLastRunAt?: Date | null;
    rowOverrides?: Record<string, unknown>;
  } = {},
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
            weekday: 1,
            hour: 8,
            timezone: 'Asia/Ho_Chi_Minh',
            metrics: [],
            createdById: 'u1',
            ...(opts.rowOverrides ?? {}),
          })),
        ),
      ),
      updateMany,
    },
  };
  const ex = extras();
  const service = new DigestsService(
    prisma as never,
    {} as never,
    { isAvailable: () => false, getClient: () => null } as never,
    {} as never,
    ex.access as never,
    ex.leadership as never,
    ex.health as never,
    ex.mail as never,
    ex.config as never,
  );
  const send = vi.spyOn(service as never, 'send' as never);
  if (opts.sendFails) send.mockRejectedValue(new Error('telegram down'));
  else send.mockResolvedValue({ sent: true, tokenUnusable: false, integrationError: false });
  vi.spyOn(service, 'buildDigest').mockResolvedValue(MODEL);
  return { service, updateMany, send };
}

type PrismaMock = {
  reportSubscription: { findMany: Mock };
  project: { findFirst: Mock };
};
const prismaOf = (service: DigestsService) => (service as unknown as { prisma: PrismaMock }).prisma;

/** 08:10 giờ VN thứ Hai 2026-10-19 — đúng giờ của mọi sub mặc định (thứ Hai 08:00 VN). */
const MONDAY_0810_VN = new Date('2026-10-19T01:10:00Z');

describe('DigestsService.runScheduled — chống gửi đôi (CAS lastRunAt)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_0810_VN);
  });
  afterEach(() => vi.useRealTimers());

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
    expect(send).toHaveBeenCalledWith('w1', 'c1', expect.stringContaining('tổng kết')); // ràng workspaceId của subscription
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

/** Prisma giả đủ cho buildDigest: mỗi nguồn là vi.fn để kiểm điều kiện lọc. */
function buildSetup(opts: { visible?: object; project?: { name: string } | null } = {}) {
  const issueCount = vi.fn(() => Promise.resolve(1));
  const issueFindMany = vi.fn(() =>
    Promise.resolve([{ key: 'A-1', summary: 'Việc trễ', dueDate: new Date('2026-10-10') }]),
  );
  const groupBy = vi.fn(() => Promise.resolve([]));
  const historyFind = vi.fn(() => Promise.resolve([]));
  const sprintFindMany = vi.fn(() =>
    Promise.resolve([
      { id: 'sp1', name: 'Tài khoản & Giỏ hàng', endDate: null, project: { key: 'A' } },
    ]),
  );
  const projectFindFirst = vi.fn(() =>
    Promise.resolve(opts.project === undefined ? { name: 'Dự án A' } : opts.project),
  );
  const projectFindMany = vi.fn(() => Promise.resolve([{ id: 'p1', key: 'A', name: 'Dự án A' }]));
  const prisma = {
    issue: { count: issueCount, findMany: issueFindMany, groupBy },
    issueHistory: { findMany: historyFind },
    sprint: { findMany: sprintFindMany },
    status: { findMany: vi.fn(() => Promise.resolve([])) },
    project: { findFirst: projectFindFirst, findMany: projectFindMany },
  };
  const ex = extras(opts.visible);
  const service = new DigestsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    ex.access as never,
    ex.leadership as never,
    ex.health as never,
    ex.mail as never,
    ex.config as never,
  );
  return {
    service,
    prisma,
    issueCount,
    issueFindMany,
    groupBy,
    historyFind,
    sprintFindMany,
    ...ex,
  };
}

const json = (m: { mock: { calls: unknown[][] } }, call = 0) =>
  JSON.stringify((m.mock.calls[call] as unknown[])[0]);
const ids = (model: DigestModel) => model.sections.map((s) => s.id);

describe('DigestsService.buildDigest — chọn khối', () => {
  it('metrics rỗng → chỉ summary + sprint (tương thích digest cũ), không gọi LeadershipService', async () => {
    const { service, leadership, health } = buildSetup();
    const model = await service.buildDigest('w1', undefined, [], 'u1');
    expect(ids(model)).toEqual(['summary', 'sprint']);
    expect(leadership.get).not.toHaveBeenCalled();
    expect(health.forProjects).not.toHaveBeenCalled();
    expect(model.sections[0]!.lines).toHaveLength(3);
  });

  it('metrics có risks → gọi LeadershipService đúng một lần với đúng thẻ; không có → không gọi', async () => {
    const { service, leadership } = buildSetup();
    const model = await service.buildDigest('w1', undefined, ['risks', 'okr'], 'u1');
    expect(ids(model)).toEqual(['risks', 'okr']);
    expect(leadership.get).toHaveBeenCalledTimes(1);
    expect(leadership.get).toHaveBeenCalledWith('w1', 'u1', expect.any(Date), {
      cards: ['topRisks', 'slowGoals'],
      projectId: undefined,
    });
  });

  it('digest gắn dự án bỏ khối workload (cấp workspace) và thu hẹp rủi ro/OKR vào dự án', async () => {
    const { service, leadership } = buildSetup();
    const model = await service.buildDigest('w1', 'p1', ['risks', 'workload'], 'u1');
    expect(ids(model)).toEqual(['risks']);
    expect(model.subtitle).toBe('Dự án: Dự án A');
    expect(leadership.get).toHaveBeenCalledWith('w1', 'u1', expect.any(Date), {
      cards: ['topRisks'],
      projectId: 'p1',
    });
  });

  it('khối rủi ro/OKR/nhân lực/sức khoẻ in số liệu thật; nguồn lỗi báo "Không tải được"', async () => {
    const { service, leadership, health } = buildSetup();
    leadership.get.mockResolvedValue({
      topRisks: [
        { levelLabel: 'Nghiêm trọng', score: 20, title: 'Lộ dữ liệu', project: { key: 'A' } },
      ],
      slowGoals: [],
      overloaded: [
        { user: { displayName: 'An' }, assignedHours: 90, capacityHours: 80, weekLabel: 'T1' },
      ],
      unavailable: ['slowGoals'],
    } as never);
    health.forProjects.mockResolvedValue(
      new Map([
        [
          'p1',
          { level: 'RED', auto: { level: 'RED', reasons: ['3/9 việc quá hạn'] }, override: null },
        ],
      ]) as never,
    );
    const model = await service.buildDigest(
      'w1',
      undefined,
      ['risks', 'okr', 'workload', 'health'],
      'u1',
    );
    const by = Object.fromEntries(model.sections.map((s) => [s.id, s.lines]));
    expect(by.risks![0]).toBe('Nghiêm trọng (20) · Lộ dữ liệu · A');
    expect(by.okr).toEqual(['Không tải được mục này.']);
    expect(by.workload![0]).toBe('An: 90h / 80h (T1)');
    expect(by.health![0]).toBe('A — Dự án A: Nguy cơ (3/9 việc quá hạn)');
  });

  it('một khối ném lỗi chỉ làm khối đó biến mất (degrade-graceful)', async () => {
    const { service, sprintFindMany } = buildSetup();
    sprintFindMany.mockRejectedValue(new Error('db'));
    const model = await service.buildDigest('w1', undefined, ['summary', 'sprint'], 'u1');
    expect(ids(model)).toEqual(['summary']);
  });

  it('tên sprint giữ nguyên "&" (không escape ở mô hình dữ liệu)', async () => {
    const { service } = buildSetup();
    const model = await service.buildDigest('w1', undefined, ['sprint'], 'u1');
    expect(model.sections[0]!.lines[0]).toContain('Tài khoản & Giỏ hàng');
    expect(JSON.stringify(model)).not.toContain('&amp;');
  });

  it('khối quá hạn: số lượng + việc trễ nhất kèm mã', async () => {
    const { service } = buildSetup();
    const model = await service.buildDigest('w1', undefined, ['overdue'], 'u1');
    expect(model.sections[0]!.lines[0]).toBe('1 việc quá hạn');
    expect(model.sections[0]!.lines[1]).toMatch(/^A-1 — Việc trễ \(trễ \d+ ngày\)$/);
  });
});

describe('DigestsService.buildDigest — quyền xem (dự án riêng tư)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

  it('MỌI truy vấn (kể cả summary) lọc dự án sống + visibleWhere của người xem', async () => {
    const s = buildSetup({ visible });
    await s.service.buildDigest('w1', undefined, ['summary', 'overdue', 'sprint', 'health'], 'u1');
    expect(s.access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    const want =
      '"project":{"deletedAt":null,"OR":[{"isPrivate":false},{"memberships":{"some":{"userId":"u1"}}}]}';
    expect(json(s.issueCount)).toContain(want);
    expect(json(s.groupBy)).toContain(want);
    expect(json(s.historyFind)).toContain(want);
    expect(json(s.issueFindMany)).toContain(want);
    expect(json(s.sprintFindMany)).toContain('"isPrivate":false');
    expect(json(s.prisma.project.findMany)).toContain('"isPrivate":false');
  });

  it('dự án người xem không thấy → không có số liệu, không lộ tên dự án', async () => {
    const s = buildSetup({ visible, project: null });
    const model = await s.service.buildDigest('w1', 'p-private', ['summary', 'risks'], 'u1');
    expect(model.subtitle).toBe('');
    expect(ids(model)).toEqual(['unavailable']);
    expect(s.issueCount).not.toHaveBeenCalled();
    expect(s.leadership.get).not.toHaveBeenCalled();
  });

  it('truyền viewerId xuống LeadershipService và ProjectHealthService', async () => {
    const s = buildSetup();
    await s.service.buildDigest('w1', undefined, ['risks', 'health'], 'u9');
    expect(s.leadership.get).toHaveBeenCalledWith('w1', 'u9', expect.any(Date), expect.anything());
    expect(s.health.forProjects).toHaveBeenCalledWith('w1', ['p1'], 'u9');
  });
});

const subRow = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    workspaceId: 'w1',
    projectId: null,
    channelId: 'ch1',
    metrics: [],
    createdById: 'admin',
    deliverEmail: false,
    allowPrivateToChannel: false,
    recipients: [],
    lastRunAt: null,
    ...over,
  }) as never;

describe('DigestsService — người xem của nội dung gửi nơi chung', () => {
  const OPTS = { closedSprintId: undefined };
  it('run: digest toàn workspace dùng PUBLIC_VIEWER (kể cả khi người tạo là admin)', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.reportSubscription.findFirst.mockResolvedValue(subRow());
    const spy = vi.spyOn(service, 'buildDigest');
    await service.run('w1', 's1', 'u1');
    expect(spy).toHaveBeenCalledWith('w1', undefined, [], PUBLIC_VIEWER, OPTS);
  });

  it('run: digest gắn dự án CÔNG KHAI → vẫn PUBLIC_VIEWER (không dùng quyền người tạo)', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.reportSubscription.findFirst.mockResolvedValue(
      subRow({ projectId: 'p1', metrics: ['summary'] }),
    );
    const spy = vi.spyOn(service, 'buildDigest');
    await service.run('w1', 's1', 'u1');
    expect(spy).toHaveBeenCalledWith('w1', 'p1', ['summary'], PUBLIC_VIEWER, OPTS);
  });

  it('I3: dự án RIÊNG TƯ + chưa bật allowPrivateToChannel → KHÔNG gửi kênh (channelSkipped), summary theo người bấm', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' });
    prisma.project.findFirst.mockResolvedValue({ isPrivate: true });
    prisma.reportSubscription.findFirst.mockResolvedValue(subRow({ projectId: 'p1' }));
    const spy = vi.spyOn(service, 'buildDigest');
    const r = await service.run('w1', 's1', 'u1');
    expect(telegram.send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, channelSkipped: true });
    // Chỉ dựng bản cho người bấm; không bao giờ dựng bản kênh với quyền người tạo.
    expect(spy.mock.calls.map((c) => c[3])).toEqual(['u1']);
  });

  it('I3: dự án riêng tư + ĐÃ bật allowPrivateToChannel → gửi kênh theo quyền người tạo', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' });
    prisma.project.findFirst.mockResolvedValue({ isPrivate: true });
    prisma.reportSubscription.findFirst.mockResolvedValue(
      subRow({ projectId: 'p1', allowPrivateToChannel: true, createdById: 'creator' }),
    );
    const spy = vi.spyOn(service, 'buildDigest');
    const r = await service.run('w1', 's1', 'u1');
    expect(spy).toHaveBeenCalledWith('w1', 'p1', [], 'creator', OPTS);
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ sent: true, channelSkipped: false });
  });

  it('I3: bật cờ nhưng người tạo không còn thấy dự án (model "unavailable") → không gửi kênh', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' });
    prisma.project.findFirst.mockResolvedValue({ isPrivate: true });
    prisma.reportSubscription.findFirst.mockResolvedValue(
      subRow({ projectId: 'p1', allowPrivateToChannel: true, createdById: 'creator' }),
    );
    vi.spyOn(service, 'buildDigest').mockResolvedValue({
      title: 't',
      subtitle: '',
      sections: [{ id: 'unavailable', title: 'x', lines: ['y'] }],
    });
    const r = await service.run('w1', 's1', 'u1');
    expect(telegram.send).not.toHaveBeenCalled();
    expect(r.channelSkipped).toBe(true);
  });

  it('dự án riêng tư đã bật cờ nhưng NGƯỜI TẠO đã bị khoá → không gửi kênh (không dùng quyền tài khoản đã khoá)', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' });
    prisma.project.findFirst.mockResolvedValue({ isPrivate: true });
    prisma.user.findUnique.mockResolvedValue({ status: 'DEACTIVATED' } as never);
    prisma.reportSubscription.findFirst.mockResolvedValue(
      subRow({ projectId: 'p1', allowPrivateToChannel: true, createdById: 'creator' }),
    );
    const spy = vi.spyOn(service, 'buildDigest');
    const r = await service.run('w1', 's1', 'u1');
    expect(telegram.send).not.toHaveBeenCalled();
    expect(r.channelSkipped).toBe(true);
    expect(spy.mock.calls.map((c) => c[3])).not.toContain('creator');
  });

  it('I3: dự án đã xoá → không gửi kênh', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' });
    prisma.project.findFirst.mockResolvedValue(null);
    prisma.reportSubscription.findFirst.mockResolvedValue(subRow({ projectId: 'p1' }));
    const r = await service.run('w1', 's1', 'u1');
    expect(telegram.send).not.toHaveBeenCalled();
    expect(r.channelSkipped).toBe(true);
  });

  it('I3: allowPrivateToChannel chỉ hợp lệ khi digest gắn dự án (422); create/update lưu cờ cho dự án riêng tư', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    prisma.project.findFirst.mockResolvedValue({ isPrivate: true });
    await expect(
      service.create('w1', 'u1', { name: 'n', allowPrivateToChannel: true }),
    ).rejects.toMatchObject({ status: 422 });
    await service.create('w1', 'u1', { name: 'n', projectId: 'p1', allowPrivateToChannel: true });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ allowPrivateToChannel: true }) as unknown,
    });
    // update: digest hiện tại không gắn dự án → bật cờ bị chặn.
    await expect(
      service.update('w1', 's1', { allowPrivateToChannel: true }, 'u1'),
    ).rejects.toMatchObject({ status: 422 });
    prisma.reportSubscription.findFirst.mockResolvedValue(subRow({ projectId: 'p1' }));
    await service.update('w1', 's1', { allowPrivateToChannel: true }, 'u1');
    expect(prisma.reportSubscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { allowPrivateToChannel: true },
    });
  });

  it('preview(as:me): theo quyền người bấm; dự án không thấy → 404 từ ProjectAccessService', async () => {
    const { service, access } = setup({ kind: 'global' });
    const spy = vi.spyOn(service, 'buildDigest');
    await expect(
      service.preview('w1', 'u7', { projectId: 'p1', metrics: ['risks'] }),
    ).resolves.toMatchObject({
      summaryText: expect.stringContaining('tổng kết') as unknown,
      channelSkipped: false,
    });
    expect(access.assertCanSee).toHaveBeenCalledWith('u7', 'w1', 'p1', 'Dự án');
    expect(spy).toHaveBeenCalledWith('w1', 'p1', ['risks'], 'u7');
    access.assertCanSee.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }));
    await expect(service.preview('w1', 'u8', { projectId: 'p1' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('preview(as:channel): khớp tin thật — PUBLIC_VIEWER; dự án riêng tư chưa bật cờ → rỗng + channelSkipped', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    const spy = vi.spyOn(service, 'buildDigest');
    await service.preview('w1', 'u7', { metrics: ['summary'], as: 'channel' });
    expect(spy).toHaveBeenCalledWith('w1', undefined, ['summary'], PUBLIC_VIEWER);
    prisma.project.findFirst.mockResolvedValue({ isPrivate: true });
    await expect(service.preview('w1', 'u7', { projectId: 'p1', as: 'channel' })).resolves.toEqual({
      summaryText: '',
      channelSkipped: true,
    });
    await service.preview('w1', 'u7', {
      projectId: 'p1',
      as: 'channel',
      allowPrivateToChannel: true,
    });
    expect(spy).toHaveBeenLastCalledWith('w1', 'p1', undefined, 'u7');
  });

  it('list lọc digest gắn dự án riêng tư người xem không thấy; admin (null) không lọc', async () => {
    const { service, prisma, access } = setup({ kind: 'global' });
    const findMany = vi.fn(() => Promise.resolve([]));
    (prisma.reportSubscription as Record<string, unknown>).findMany = findMany;
    access.visibleProjectIds.mockResolvedValueOnce(['p-pub'] as never);
    await service.list('w1', undefined, 'u1');
    expect(json(findMany)).toContain('"OR":[{"projectId":null},{"projectId":{"in":["p-pub"]}}]');
    await service.list('w1', undefined, 'admin');
    expect(json(findMany, 1)).not.toContain('"OR"');
  });

  it('create gắn dự án: người tạo phải thấy dự án', async () => {
    const { service, prisma, access } = setup({ kind: 'global' });
    (prisma.reportSubscription as Record<string, unknown>).create = vi.fn();
    await service.create('w1', 'u1', { name: 'n', projectId: 'p1' });
    expect(access.assertCanSee).toHaveBeenCalledWith('u1', 'w1', 'p1', 'Dự án');
  });
});

describe('digest schemas', () => {
  it('createDigestSchema từ chối khối lạ', () => {
    expect(createDigestSchema.safeParse({ name: 'x', metrics: ['abc'] }).success).toBe(false);
    expect(createDigestSchema.safeParse({ name: 'x', metrics: ['risks', 'okr'] }).success).toBe(
      true,
    );
    expect(updateDigestSchema.safeParse({ metrics: ['abc'] }).success).toBe(false);
  });

  it('previewDigestSchema: khối lạ bị từ chối, trống hợp lệ', () => {
    expect(previewDigestSchema.safeParse({ metrics: ['abc'] }).success).toBe(false);
    expect(previewDigestSchema.safeParse({}).success).toBe(true);
  });
});

describe('DigestsService.runScheduled — lịch thứ/giờ/múi giờ (L20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_0810_VN);
  });
  afterEach(() => vi.useRealTimers());

  it('chỉ nạp DAILY/WEEKLY đang bật (SPRINT_END/MANUAL không do cron)', async () => {
    const node = makeNode([{ id: 's1', lastRunAt: null }]);
    await node.service.runScheduled();
    const prisma = prismaOf(node.service);
    expect(json(prisma.reportSubscription.findMany)).toContain(
      '"schedule":{"in":["DAILY","WEEKLY"]}',
    );
    expect(json(prisma.reportSubscription.findMany)).toContain('"isEnabled":true');
  });

  it('sai giờ → không gửi; đúng giờ → gửi một lần', async () => {
    const off = makeNode([{ id: 's1', lastRunAt: null }], { rowOverrides: { hour: 9 } });
    await off.service.runScheduled();
    expect(off.send).not.toHaveBeenCalled();
    const on = makeNode([{ id: 's1', lastRunAt: null }], { rowOverrides: { hour: 8 } });
    await on.service.runScheduled();
    expect(on.send).toHaveBeenCalledTimes(1);
  });

  it('WEEKLY: chỉ đúng thứ đã chọn (không còn cứng thứ Hai theo giờ máy chủ)', async () => {
    const tue = makeNode([{ id: 's1', lastRunAt: null }], {
      rowOverrides: { schedule: 'WEEKLY', weekday: 2 },
    });
    await tue.service.runScheduled();
    expect(tue.send).not.toHaveBeenCalled();
    const mon = makeNode([{ id: 's1', lastRunAt: null }], {
      rowOverrides: { schedule: 'WEEKLY', weekday: 1 },
    });
    await mon.service.runScheduled();
    expect(mon.send).toHaveBeenCalledTimes(1);
  });

  it('múi giờ khác: 08:10 VN = 21:10 giờ New_York hôm trước → sub 21h New_York đến hạn', async () => {
    const n = makeNode([{ id: 's1', lastRunAt: null }], {
      rowOverrides: { hour: 21, timezone: 'America/New_York' },
    });
    await n.service.runScheduled();
    expect(n.send).toHaveBeenCalledTimes(1);
  });

  it('lastRunAt nằm trong CÙNG giờ địa phương (dù > 30 phút trước) → không gửi lại', async () => {
    // Lần gửi trước 07:35 VN (khác giờ địa phương) → gửi bình thường.
    const earlier = makeNode([
      { id: 's1', lastRunAt: new Date(MONDAY_0810_VN.getTime() - 35 * 60_000) },
    ]);
    await earlier.service.runScheduled();
    expect(earlier.send).toHaveBeenCalledTimes(1);
    // Lần gửi trước 08:00:30 VN, nay 08:50 VN: 49 phút (ngoài cửa sổ dedupe 30 phút) nhưng vẫn CÙNG giờ 08 → không gửi lại.
    const sameHour = makeNode([{ id: 's1', lastRunAt: new Date('2026-10-19T01:00:30Z') }]);
    vi.setSystemTime(new Date('2026-10-19T01:50:00Z'));
    await sameHour.service.runScheduled();
    expect(sameHour.send).not.toHaveBeenCalled();
  });

  it('múi giờ hỏng trong DB không làm hỏng vòng cron: bỏ qua sub đó, vẫn gửi sub khác', async () => {
    const n = makeNode(
      [
        { id: 'bad', lastRunAt: null },
        { id: 'ok', lastRunAt: null },
      ],
      {},
    );
    const prisma = prismaOf(n.service);
    const rows = (await prisma.reportSubscription.findMany()) as Array<Record<string, unknown>>;
    rows[0]!.timezone = 'Mars/Base';
    prisma.reportSubscription.findMany.mockResolvedValue(rows);
    await n.service.runScheduled();
    expect(n.send).toHaveBeenCalledTimes(1);
  });
});

describe('DigestsService.onSprintCompleted — SPRINT_END theo sự kiện (L20)', () => {
  function sprintEnd(subs: Array<Record<string, unknown>>) {
    const table: SubRow[] = subs.map((s) => ({
      id: s.id as string,
      lastRunAt: (s.lastRunAt as Date | undefined) ?? null,
    }));
    const node = makeNode(table);
    const prisma = prismaOf(node.service);
    prisma.project = { findFirst: vi.fn(() => Promise.resolve({ workspaceId: 'w1' })) };
    prisma.reportSubscription.findMany = vi.fn(() =>
      Promise.resolve(
        subs.map((s) => ({
          workspaceId: 'w1',
          channelId: 'c1',
          schedule: 'SPRINT_END',
          metrics: [],
          createdById: 'u1',
          lastRunAt: null,
          projectId: null,
          ...s,
        })),
      ),
    );
    return { ...node, prisma };
  }

  it('gửi các digest SPRINT_END đang bật của workspace chứa sprint', async () => {
    const t = sprintEnd([{ id: 'a' }, { id: 'b', projectId: 'p1' }]);
    await t.service.onSprintCompleted({ sprintId: 'sp1', projectId: 'p1' });
    expect(t.send).toHaveBeenCalledTimes(2);
    const where = json(t.prisma.reportSubscription.findMany);
    expect(where).toContain('"workspaceId":"w1"');
    expect(where).toContain('"schedule":"SPRINT_END"');
    expect(where).toContain('"isEnabled":true');
    expect(where).toContain('"OR":[{"projectId":null},{"projectId":"p1"}]');
  });

  it('không có digest nào → không gửi, không lỗi', async () => {
    const t = sprintEnd([]);
    await t.service.onSprintCompleted({ sprintId: 'sp1', projectId: 'p1' });
    expect(t.send).not.toHaveBeenCalled();
  });

  it('dự án không tồn tại → bỏ qua, không ném', async () => {
    const t = sprintEnd([{ id: 'a' }]);
    t.prisma.project.findFirst.mockResolvedValue(null);
    await expect(
      t.service.onSprintCompleted({ sprintId: 'sp1', projectId: 'p1' }),
    ).resolves.toBeUndefined();
    expect(t.send).not.toHaveBeenCalled();
  });

  it('lỗi gửi/tra cứu không được ném ra (không làm hỏng việc đóng sprint)', async () => {
    const t = sprintEnd([{ id: 'a' }]);
    t.prisma.reportSubscription.findMany.mockRejectedValue(new Error('db'));
    await expect(
      t.service.onSprintCompleted({ sprintId: 'sp1', projectId: 'p1' }),
    ).resolves.toBeUndefined();
    const t2 = sprintEnd([{ id: 'a' }]);
    t2.send.mockRejectedValue(new Error('telegram'));
    await expect(
      t2.service.onSprintCompleted({ sprintId: 'sp1', projectId: 'p1' }),
    ).resolves.toBeUndefined();
  });

  it('hai sprint đóng liên tiếp đều gửi (không dính cửa sổ dedupe 30 phút của cron)', async () => {
    const t = sprintEnd([{ id: 'a', lastRunAt: new Date(Date.now() - 60_000) }]);
    await t.service.onSprintCompleted({ sprintId: 'sp1', projectId: 'p1' });
    expect(t.send).toHaveBeenCalledTimes(1);
  });
});

describe('digest schedule schemas (L20)', () => {
  it('weekday 0–6, hour 0–23, timezone IANA hợp lệ', () => {
    const ok = { name: 'x', weekday: 1, hour: 8, timezone: 'Asia/Ho_Chi_Minh' };
    expect(createDigestSchema.safeParse(ok).success).toBe(true);
    expect(createDigestSchema.safeParse({ ...ok, weekday: 7 }).success).toBe(false);
    expect(createDigestSchema.safeParse({ ...ok, weekday: -1 }).success).toBe(false);
    expect(createDigestSchema.safeParse({ ...ok, hour: 24 }).success).toBe(false);
    expect(createDigestSchema.safeParse({ ...ok, hour: 8.5 }).success).toBe(false);
    expect(createDigestSchema.safeParse({ ...ok, timezone: 'Mars/Base' }).success).toBe(false);
    expect(updateDigestSchema.safeParse({ hour: 25 }).success).toBe(false);
    expect(updateDigestSchema.safeParse({ timezone: 'Asia/Tokyo', weekday: 6 }).success).toBe(true);
  });

  it('create/update lưu weekday/hour/timezone', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    await service.create('w1', 'u1', { name: 'n', weekday: 5, hour: 17, timezone: 'Asia/Tokyo' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ weekday: 5, hour: 17, timezone: 'Asia/Tokyo' }) as unknown,
    });
    await service.update('w1', 's1', { weekday: 2, hour: 9, timezone: 'Asia/Bangkok' }, 'u1');
    expect(prisma.reportSubscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { weekday: 2, hour: 9, timezone: 'Asia/Bangkok' },
    });
  });
});

const USERS = [
  { id: 'u2', email: 'b@x.vn', displayName: 'Bình' },
  { id: 'u3', email: 'c@x.vn', displayName: 'Cúc' },
];

function emailSetup(over: Record<string, unknown> = {}, users: unknown[] = USERS) {
  const t = setup({ kind: 'global' });
  t.prisma.reportSubscription.findFirst.mockResolvedValue({
    id: 's1',
    workspaceId: 'w1',
    projectId: null,
    channelId: null,
    metrics: ['summary'],
    createdById: 'u1',
    deliverEmail: true,
    recipients: ['u2', 'u3'],
    name: 'Tuần',
    ...over,
  } as never);
  t.prisma.user.findMany.mockResolvedValue(users);
  return t;
}

describe('DigestsService — gửi Email (L21)', () => {
  it('deliverEmail + 2 người nhận → mail.enqueue 2 lần, template digest, to = email từng người', async () => {
    const t = emailSetup();
    await t.service.run('w1', 's1', 'u1');
    expect(t.mail.enqueue).toHaveBeenCalledTimes(2);
    const calls = t.mail.enqueue.mock.calls as unknown as Array<
      [{ to: string; template: string; payload: Record<string, unknown> }]
    >;
    expect(calls.map((c) => c[0].to)).toEqual(['b@x.vn', 'c@x.vn']);
    expect(calls.every((c) => c[0].template === 'digest')).toBe(true);
    expect(calls[0]![0].payload).toMatchObject({
      title: 'Tổng kết tuần',
      url: 'http://app.test',
      sections: expect.any(Array) as unknown,
    });
  });

  it('chỉ lấy thành viên workspace chưa bị khoá (không gửi cho người ngoài/đã vô hiệu hoá)', async () => {
    const t = emailSetup();
    await t.service.run('w1', 's1', 'u1');
    expect(json(t.prisma.user.findMany)).toBe(
      JSON.stringify({
        where: {
          id: { in: ['u2', 'u3'] },
          status: { not: 'DEACTIVATED' },
          workspaceMemberships: { some: { workspaceId: 'w1' } },
        },
        select: { id: true, email: true, displayName: true },
      }),
    );
  });

  it('mỗi người nhận một bản dựng theo quyền xem của CHÍNH họ', async () => {
    const t = emailSetup();
    const spy = vi.spyOn(t.service, 'buildDigest');
    await t.service.run('w1', 's1', 'u1');
    const viewers = spy.mock.calls.map((c) => c[3]);
    expect(viewers).toContain('u2');
    expect(viewers).toContain('u3');
    // Chỉ email (không kênh): bản tóm tắt trả cho người bấm = bản theo quyền của CHÍNH họ (không phải bản công khai).
    expect(viewers).toContain('u1');
    expect(viewers).not.toContain(PUBLIC_VIEWER);
  });

  it('digest gắn dự án: người nhận không thấy dự án thì KHÔNG được gửi thư', async () => {
    const t = emailSetup({ projectId: 'p1' });
    t.access.canSee.mockImplementation(((uid: string) => Promise.resolve(uid !== 'u3')) as never);
    const r = await t.service.run('w1', 's1', 'u1');
    expect(t.mail.enqueue).toHaveBeenCalledTimes(1);
    expect(t.mail.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'b@x.vn' }) as unknown,
    );
    expect(r.sent).toBe(true);
  });

  it('chỉ email (không channelId) vẫn sent:true và ghi lastRunAt', async () => {
    const t = emailSetup();
    const r = await t.service.run('w1', 's1', 'u1');
    expect(r.sent).toBe(true);
    expect(t.telegram.send).not.toHaveBeenCalled();
    expect(t.prisma.reportSubscription.update).toHaveBeenCalledTimes(1);
  });

  it('không người nhận nào gửi được (0 thư, không kênh) → sent:false, không ghi lastRunAt', async () => {
    const t = emailSetup({}, []);
    const r = await t.service.run('w1', 's1', 'u1');
    expect(r.sent).toBe(false);
    expect(t.prisma.reportSubscription.update).not.toHaveBeenCalled();
  });

  it('lỗi xếp thư của một người không chặn người còn lại', async () => {
    const t = emailSetup();
    t.mail.enqueue.mockRejectedValueOnce(new Error('db'));
    const r = await t.service.run('w1', 's1', 'u1');
    expect(t.mail.enqueue).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(true);
  });

  it('Telegram + Email độc lập: cả hai đều đi', async () => {
    const t = emailSetup({ channelId: 'ch1' });
    const r = await t.service.run('w1', 's1', 'u1');
    expect(t.telegram.send).toHaveBeenCalledTimes(1);
    expect(t.mail.enqueue).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(true);
  });

  it('không bật deliverEmail → không gửi thư dù có recipients', async () => {
    const t = emailSetup({ deliverEmail: false });
    await t.service.run('w1', 's1', 'u1');
    expect(t.mail.enqueue).not.toHaveBeenCalled();
  });
});

describe('DigestsService — cấu hình kênh Email (L21)', () => {
  it('create: deliverEmail bắt buộc ≥1 người nhận (422)', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    await expect(
      service.create('w1', 'u1', { name: 'n', deliverEmail: true }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.create('w1', 'u1', { name: 'n', deliverEmail: true, recipients: [] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(create).not.toHaveBeenCalled();
  });

  it('create: người nhận ngoài workspace → 422, không ghi', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    prisma.user.findMany.mockResolvedValue([{ id: 'u2' }]); // 'u9' không phải thành viên
    await expect(
      service.create('w1', 'u1', { name: 'n', deliverEmail: true, recipients: ['u2', 'u9'] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(create).not.toHaveBeenCalled();
  });

  it('create hợp lệ lưu deliverEmail + recipients (bỏ trùng)', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    prisma.user.findMany.mockResolvedValue([{ id: 'u2' }]);
    await service.create('w1', 'u1', {
      name: 'n',
      deliverEmail: true,
      recipients: ['u2', 'u2'],
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deliverEmail: true, recipients: ['u2'] }) as unknown,
    });
  });

  it('update: bật deliverEmail khi chưa có người nhận → 422; tắt thì không cần', async () => {
    const t = setup({ kind: 'global' });
    await expect(t.service.update('w1', 's1', { deliverEmail: true }, 'u1')).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      t.service.update('w1', 's1', { deliverEmail: false }, 'u1'),
    ).resolves.toBeDefined();
  });

  it('update: gỡ hết người nhận khi đang bật email → 422', async () => {
    const t = emailSetup();
    await expect(t.service.update('w1', 's1', { recipients: [] }, 'u1')).rejects.toMatchObject({
      status: 422,
    });
  });

  it('cron/sự kiện cũng gửi email (không chỉ Telegram)', async () => {
    const t = emailSetup();
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_0810_VN);
    try {
      (t.service as unknown as { redis: unknown }).redis = {
        isAvailable: () => false,
        getClient: () => null,
      };
      const prisma = prismaOf(t.service);
      prisma.reportSubscription.findMany = vi.fn(() =>
        Promise.resolve([
          {
            id: 's1',
            workspaceId: 'w1',
            projectId: null,
            channelId: null,
            schedule: 'DAILY',
            weekday: 1,
            hour: 8,
            timezone: 'Asia/Ho_Chi_Minh',
            metrics: ['summary'],
            createdById: 'u1',
            deliverEmail: true,
            recipients: ['u2', 'u3'],
            name: 'Tuần',
            lastRunAt: null,
          },
        ]),
      );
      (prisma.reportSubscription as unknown as { updateMany: Mock }).updateMany = vi.fn(() =>
        Promise.resolve({ count: 1 }),
      );
      await t.service.runScheduled();
      expect(t.mail.enqueue).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('digest email schemas (L21)', () => {
  it('deliverEmail boolean; recipients ≤ 50 chuỗi không rỗng', () => {
    expect(createDigestSchema.safeParse({ name: 'x', deliverEmail: true }).success).toBe(true);
    expect(createDigestSchema.safeParse({ name: 'x', deliverEmail: 'yes' }).success).toBe(false);
    expect(createDigestSchema.safeParse({ name: 'x', recipients: [''] }).success).toBe(false);
    expect(
      createDigestSchema.safeParse({
        name: 'x',
        recipients: Array.from({ length: 51 }, (_, i) => `u${i}`),
      }).success,
    ).toBe(false);
    expect(updateDigestSchema.safeParse({ deliverEmail: false, recipients: ['u1'] }).success).toBe(
      true,
    );
  });
});

describe('DigestsService — dự án riêng tư: người không thấy → 404 ở update/remove/run (hợp nhất P15)', () => {
  function hidden() {
    const t = setup({ kind: 'global' });
    t.prisma.reportSubscription.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      projectId: 'pHidden',
      channelId: 'ch1',
      metrics: [],
      createdById: 'c',
      deliverEmail: false,
      allowPrivateToChannel: false,
      recipients: [],
      lastRunAt: null,
    } as never);
    t.access.assertCanSee.mockImplementation(((
      _u: string,
      _w: string,
      _p: string,
      label?: string,
    ) => Promise.reject(Object.assign(new Error(label), { status: 404 }))) as never);
    (t.prisma.reportSubscription as Record<string, unknown>).delete = vi.fn();
    return t;
  }

  it('update/remove/run → 404, không ghi, không gửi, không trả số liệu', async () => {
    const t = hidden();
    await expect(t.service.update('w1', 's1', { name: 'x' }, 'u9')).rejects.toMatchObject({
      status: 404,
    });
    await expect(t.service.remove('w1', 's1', 'u9')).rejects.toMatchObject({ status: 404 });
    await expect(t.service.run('w1', 's1', 'u9')).rejects.toMatchObject({ status: 404 });
    expect(t.access.assertCanSee).toHaveBeenCalledWith('u9', 'w1', 'pHidden', 'Báo cáo định kỳ');
    expect(t.prisma.reportSubscription.update).not.toHaveBeenCalled();
    expect(t.telegram.send).not.toHaveBeenCalled();
  });
});

describe('DigestsService.run — email: xác nhận phía FE + giới hạn tần suất phía server (L21 review)', () => {
  function emailRun(claimCount: number) {
    const t = setup({ kind: 'global' });
    t.prisma.reportSubscription.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      projectId: null,
      channelId: null,
      metrics: ['summary'],
      createdById: 'u1',
      deliverEmail: true,
      allowPrivateToChannel: false,
      recipients: ['u2'],
      lastRunAt: new Date('2026-10-16T01:00:00Z'),
      name: 'T',
    } as never);
    t.prisma.user.findMany.mockResolvedValue([{ id: 'u2', email: 'b@x.vn', displayName: 'B' }]);
    t.prisma.reportSubscription.updateMany.mockResolvedValue({ count: claimCount });
    return t;
  }

  it('giữ chỗ bằng CAS lastRunAt (< 1 phút trước thì thua) → 422, không gửi thư', async () => {
    const t = emailRun(0);
    await expect(t.service.run('w1', 's1', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(t.mail.enqueue).not.toHaveBeenCalled();
    const where = JSON.stringify(t.prisma.reportSubscription.updateMany.mock.calls[0]);
    expect(where).toContain('"lastRunAt":null');
    expect(where).toContain('"lt"');
  });

  it('giữ chỗ được → gửi; gửi 0 thư (không ai nhận) → trả lastRunAt về giá trị cũ', async () => {
    const ok = emailRun(1);
    await ok.service.run('w1', 's1', 'u1');
    expect(ok.mail.enqueue).toHaveBeenCalledTimes(1);
    const none = emailRun(1);
    none.prisma.user.findMany.mockResolvedValue([]);
    await none.service.run('w1', 's1', 'u1');
    const calls = none.prisma.reportSubscription.updateMany.mock.calls as unknown as Array<
      [{ data: { lastRunAt: Date } }]
    >;
    expect(calls.at(-1)![0].data.lastRunAt).toEqual(new Date('2026-10-16T01:00:00Z'));
  });

  it('digest không email không bị giới hạn tần suất', async () => {
    const t = setup({ kind: 'global' });
    await t.service.run('w1', 's1', 'u1');
    await t.service.run('w1', 's1', 'u1');
    expect(t.prisma.reportSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('dựng email theo lô song song (không tuần tự từng người)', async () => {
    const t = emailRun(1);
    const users = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      email: `r${i}@x.vn`,
      displayName: `R${i}`,
    }));
    t.prisma.user.findMany.mockResolvedValue(users);
    let active = 0;
    let peak = 0;
    vi.spyOn(t.service, 'buildDigest').mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return MODEL;
    });
    await t.service.run('w1', 's1', 'u1');
    expect(t.mail.enqueue).toHaveBeenCalledTimes(12);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });
});

describe('DigestsService.onSprintCompleted — nội dung & không mất digest (L20 review)', () => {
  function sprintEnd(n: number) {
    const t = setup({ kind: 'global' });
    const p = prismaOf(t.service) as PrismaMock & Record<string, Record<string, Mock>>;
    p.project = { findFirst: vi.fn(() => Promise.resolve({ workspaceId: 'w1' })) };
    p.reportSubscription.findMany = vi.fn(() =>
      Promise.resolve(
        Array.from({ length: n }, (_, i) => ({
          id: `s${i}`,
          name: 'T',
          workspaceId: 'w1',
          projectId: null,
          channelId: 'ch1',
          metrics: ['summary'],
          createdById: 'u1',
          deliverEmail: false,
          allowPrivateToChannel: false,
          recipients: [],
          schedule: 'SPRINT_END',
          weekday: 1,
          hour: 8,
          timezone: 'Asia/Ho_Chi_Minh',
          lastRunAt: null,
        })),
      ),
    );
    return { ...t, p };
  }

  it('truyền sprint vừa đóng vào buildDigest để nội dung nêu sprint đó', async () => {
    const t = sprintEnd(1);
    const spy = vi.spyOn(t.service, 'buildDigest');
    await t.service.onSprintCompleted({ sprintId: 'sp9', projectId: 'p1' });
    expect(spy).toHaveBeenCalledWith('w1', undefined, ['summary'], PUBLIC_VIEWER, {
      closedSprintId: 'sp9',
    });
  });

  it('hai sự kiện đồng thời đều gửi: không dùng CAS lastRunAt (sự kiện chỉ một node xử lý)', async () => {
    const t = sprintEnd(1);
    await Promise.all([
      t.service.onSprintCompleted({ sprintId: 'a', projectId: 'p1' }),
      t.service.onSprintCompleted({ sprintId: 'b', projectId: 'p1' }),
    ]);
    expect(t.telegram.send).toHaveBeenCalledTimes(2);
    expect(t.prisma.reportSubscription.updateMany).not.toHaveBeenCalled();
    expect(t.prisma.reportSubscription.update).toHaveBeenCalled(); // ghi lastRunAt sau khi gửi
  });
});

describe('DigestsService.buildDigest — khối "Sprint vừa kết thúc"', () => {
  it('có closedSprintId → khối đứng đầu, lọc theo dự án người xem thấy; sprint ẩn → không có khối', async () => {
    const s = buildSetup({ visible: { isPrivate: false } });
    s.sprintFindMany.mockResolvedValue([]);
    const sprintFindFirst = vi.fn(() =>
      Promise.resolve({ name: 'Sprint 7', project: { key: 'A' } }),
    );
    (s.prisma.sprint as Record<string, unknown>).findFirst = sprintFindFirst;
    const m = await s.service.buildDigest('w1', undefined, ['summary'], 'u1', {
      closedSprintId: 'sp7',
    });
    expect(m.sections[0]).toMatchObject({ id: 'sprint-closed', lines: ['[A] Sprint 7'] });
    const arg = JSON.stringify(sprintFindFirst.mock.calls[0]);
    expect(arg).toContain('"id":"sp7"');
    expect(arg).toContain('"deletedAt":null');
    expect(arg).toContain('"isPrivate":false');
    sprintFindFirst.mockResolvedValue(null as never);
    const hiddenModel = await s.service.buildDigest('w1', undefined, ['summary'], 'u1', {
      closedSprintId: 'sp7',
    });
    expect(hiddenModel.sections.some((x) => x.id === 'sprint-closed')).toBe(false);
  });
});

describe('digest schemas — allowPrivateToChannel / preview (review vòng 1)', () => {
  it('allowPrivateToChannel là boolean tuỳ chọn ở create/update/preview', () => {
    expect(createDigestSchema.safeParse({ name: 'x', allowPrivateToChannel: true }).success).toBe(
      true,
    );
    expect(updateDigestSchema.safeParse({ allowPrivateToChannel: 'yes' }).success).toBe(false);
    expect(
      previewDigestSchema.safeParse({ as: 'channel', allowPrivateToChannel: true }).success,
    ).toBe(true);
    expect(previewDigestSchema.safeParse({ as: 'everyone' }).success).toBe(false);
  });
});

describe('DigestsService.run — N3 hoàn lastRunAt bằng CAS; M4 báo người nhận bị bỏ qua', () => {
  function emailRun(users: Array<{ id: string; email: string; displayName: string }>) {
    const t = setup({ kind: 'global' });
    t.prisma.reportSubscription.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      projectId: 'p1',
      channelId: null,
      metrics: ['summary'],
      createdById: 'u1',
      deliverEmail: true,
      allowPrivateToChannel: false,
      recipients: users.map((u) => u.id),
      lastRunAt: new Date('2026-10-16T01:00:00Z'),
      name: 'T',
    } as never);
    t.prisma.user.findMany.mockResolvedValue(users);
    return t;
  }
  const U = [
    { id: 'u2', email: 'b@x.vn', displayName: 'Bình' },
    { id: 'u3', email: 'c@x.vn', displayName: 'Cúc' },
  ];

  it('N3: không gửi được gì → hoàn lastRunAt CHỈ khi vẫn là giá trị mình đặt (where có lastRunAt = claimedAt)', async () => {
    const t = emailRun(U);
    t.access.canSee.mockResolvedValue(false); // không ai thấy dự án → 0 thư
    await t.service.run('w1', 's1', 'u1');
    const calls = t.prisma.reportSubscription.updateMany.mock.calls as unknown as Array<
      [{ where: { id: string; lastRunAt: unknown }; data: { lastRunAt: Date | null } }]
    >;
    const claim = calls[0]![0];
    const restore = calls.at(-1)![0];
    expect(restore.data.lastRunAt).toEqual(new Date('2026-10-16T01:00:00Z'));
    // CAS: where.lastRunAt chính là mốc đã đặt lúc giữ chỗ (không phải điều kiện tuỳ ý).
    expect(restore.where.lastRunAt).toBe(claim.data.lastRunAt);
  });

  it('M4: người nhận không thấy dự án gắn kèm bị bỏ qua và được trả lại trong skippedRecipients', async () => {
    const t = emailRun(U);
    t.access.canSee.mockImplementation(((uid: string) => Promise.resolve(uid !== 'u3')) as never);
    const r = await t.service.run('w1', 's1', 'u1');
    expect(r.sent).toBe(true);
    expect(r.skippedRecipients).toEqual(['Cúc']);
    expect(t.mail.enqueue).toHaveBeenCalledTimes(1);
  });

  it('M4: mọi người đều thấy → skippedRecipients rỗng', async () => {
    const t = emailRun(U);
    const r = await t.service.run('w1', 's1', 'u1');
    expect(r.skippedRecipients).toEqual([]);
  });
});

describe('DigestsService — cờ allowPrivateToChannel không "dính" (N1)', () => {
  it('N1: dự án CÔNG KHAI → server chuẩn hoá cờ về false (create và update), cờ không "dính"', async () => {
    const { service, prisma } = setup({ kind: 'global' }); // project.findFirst mặc định isPrivate:false
    const create = vi.fn();
    (prisma.reportSubscription as Record<string, unknown>).create = create;
    await service.create('w1', 'u1', { name: 'n', projectId: 'pPub', allowPrivateToChannel: true });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ allowPrivateToChannel: false }) as unknown,
    });
    prisma.reportSubscription.findFirst.mockResolvedValue(subRow({ projectId: 'pPub' }));
    await service.update('w1', 's1', { allowPrivateToChannel: true }, 'u1');
    expect(prisma.reportSubscription.update).toHaveBeenLastCalledWith({
      where: { id: 's1' },
      data: { allowPrivateToChannel: false },
    });
  });

  it('N1: cờ cũ đã lưu true nhưng dự án nay công khai → lần sửa kế tiếp tự chuẩn hoá về false', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.reportSubscription.findFirst.mockResolvedValue(
      subRow({ projectId: 'pPub', allowPrivateToChannel: true }),
    );
    await service.update('w1', 's1', { name: 'đổi tên' }, 'u1');
    expect(prisma.reportSubscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { name: 'đổi tên', allowPrivateToChannel: false },
    });
  });

  it('N1: dự án đổi công khai ⇄ riêng tư (sự kiện) → xoá cờ của mọi digest gắn dự án đó, digest không tự lên kênh', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    await service.onProjectVisibilityChanged({ workspaceId: 'w1', projectId: 'p1' });
    expect(prisma.reportSubscription.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', projectId: 'p1', allowPrivateToChannel: true },
      data: { allowPrivateToChannel: false },
    });
    // Thiếu dữ liệu sự kiện / lỗi DB → không ném.
    prisma.reportSubscription.updateMany.mockClear();
    await service.onProjectVisibilityChanged({});
    expect(prisma.reportSubscription.updateMany).not.toHaveBeenCalled();
    prisma.reportSubscription.updateMany.mockRejectedValueOnce(new Error('db'));
    await expect(
      service.onProjectVisibilityChanged({ workspaceId: 'w1', projectId: 'p1' }),
    ).resolves.toBeUndefined();
  });
});
