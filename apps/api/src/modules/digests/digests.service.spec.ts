import { describe, expect, it, vi } from 'vitest';
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
  };
  const leadership = {
    get: vi.fn(() =>
      Promise.resolve({ topRisks: [], slowGoals: [], overloaded: [], unavailable: [] }),
    ),
  };
  const health = { forProjects: vi.fn(() => Promise.resolve(new Map())) };
  return { access, leadership, health };
}

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
  const ex = extras();
  const service = new DigestsService(
    prisma as never,
    telegram as never,
    {} as never,
    integrations as never,
    ex.access as never,
    ex.leadership as never,
    ex.health as never,
  );
  vi.spyOn(service, 'buildDigest').mockResolvedValue(MODEL);
  return { service, prisma, telegram, integrations, ...ex };
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
    expect(telegram.send).toHaveBeenCalledWith(null, 'c1', expect.stringContaining('tổng kết'));
  });

  it('own/global → gửi như cũ', async () => {
    const { service, telegram } = setup({ kind: 'own', token: 'T' });
    await expect(service.run('w1', 's1')).resolves.toMatchObject({ sent: true });
    expect(telegram.send).toHaveBeenCalledWith('T', 'c1', expect.stringContaining('tổng kết'));
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
  const ex = extras();
  const service = new DigestsService(
    prisma as never,
    {} as never,
    { isAvailable: () => false, getClient: () => null } as never,
    {} as never,
    ex.access as never,
    ex.leadership as never,
    ex.health as never,
  );
  const send = vi.spyOn(service as never, 'send' as never);
  if (opts.sendFails) send.mockRejectedValue(new Error('telegram down'));
  else send.mockResolvedValue({ sent: true, tokenUnusable: false, integrationError: false });
  vi.spyOn(service, 'buildDigest').mockResolvedValue(MODEL);
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

describe('DigestsService — người xem của nội dung gửi nơi chung', () => {
  it('run: digest toàn workspace dùng PUBLIC_VIEWER (kể cả khi người tạo là admin)', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.reportSubscription.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      projectId: null,
      channelId: 'ch1',
      metrics: [],
      createdById: 'admin',
    } as never);
    const spy = vi.spyOn(service, 'buildDigest');
    await service.run('w1', 's1');
    expect(spy).toHaveBeenCalledWith('w1', undefined, [], PUBLIC_VIEWER);
  });

  it('run: digest gắn dự án theo quyền người tạo (đã chọn rõ dự án đó)', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    prisma.reportSubscription.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      projectId: 'p1',
      channelId: 'ch1',
      metrics: ['summary'],
      createdById: 'creator',
    } as never);
    const spy = vi.spyOn(service, 'buildDigest');
    await service.run('w1', 's1');
    expect(spy).toHaveBeenCalledWith('w1', 'p1', ['summary'], 'creator');
  });

  it('preview: theo quyền người bấm; dự án không thấy → ném 404 từ ProjectAccessService', async () => {
    const { service, access } = setup({ kind: 'global' });
    const spy = vi.spyOn(service, 'buildDigest');
    await expect(
      service.preview('w1', 'u7', { projectId: 'p1', metrics: ['risks'] }),
    ).resolves.toEqual({
      summaryText: expect.stringContaining('tổng kết') as unknown,
    });
    expect(access.assertCanSee).toHaveBeenCalledWith('u7', 'w1', 'p1', 'Dự án');
    expect(spy).toHaveBeenCalledWith('w1', 'p1', ['risks'], 'u7');
  });

  it('list lọc digest gắn dự án riêng tư người xem không thấy; admin (null) không lọc', async () => {
    const { service, prisma, access } = setup({ kind: 'global' });
    const findMany = vi.fn(() => Promise.resolve([]));
    (prisma.reportSubscription as Record<string, unknown>).findMany = findMany;
    access.visibleProjectIds.mockResolvedValueOnce(['p-pub'] as never);
    await service.list('w1', 'u1');
    expect(json(findMany)).toContain('"OR":[{"projectId":null},{"projectId":{"in":["p-pub"]}}]');
    await service.list('w1', 'admin');
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
