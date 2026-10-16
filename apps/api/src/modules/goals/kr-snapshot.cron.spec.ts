import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resetCronLockWarning } from '../../common/cron-lock';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { KrMeasureService } from './kr-measure.service';
import { KrSnapshotCron } from './kr-snapshot.cron';

const NOW = new Date('2026-10-16T01:30:00Z');
const TODAY = new Date('2026-10-16T00:00:00.000Z');

interface Kr {
  id: string;
  source: string;
  sourceConfig: unknown;
  currentValue: number;
}
interface Obj {
  id: string;
  period: string;
  keyResults: Kr[];
}

const kr = (id: string, source = 'MANUAL', currentValue = 3): Kr => ({
  id,
  source,
  sourceConfig: source === 'MANUAL' ? null : {},
  currentValue,
});

function make(opts: {
  workspaces?: string[];
  objectives?: Record<string, Obj[]>;
  existing?: string[];
  measured?: Map<string, unknown>;
  redis?: unknown;
}) {
  const prisma = {
    workspace: {
      findMany: vi.fn((_a?: unknown) =>
        Promise.resolve((opts.workspaces ?? ['w1']).map((id) => ({ id }))),
      ),
    },
    objective: {
      findMany: vi.fn((a: { where: { workspaceId: string } }) =>
        Promise.resolve(opts.objectives?.[a.where.workspaceId] ?? []),
      ),
    },
    keyResult: { findFirst: vi.fn((_a?: unknown) => Promise.resolve(null as unknown)) },
    keyResultCheckIn: {
      findMany: vi.fn((_a?: unknown) =>
        Promise.resolve((opts.existing ?? []).map((keyResultId) => ({ keyResultId }))),
      ),
      createMany: vi.fn((a: { data: unknown[] }) => Promise.resolve({ count: a.data.length })),
      upsert: vi.fn((_a?: unknown) => Promise.resolve({})),
    },
  };
  const measurer = {
    measure: vi.fn((..._a: unknown[]) => Promise.resolve(opts.measured ?? new Map())),
  };
  const redis = opts.redis ?? { isAvailable: () => false, getClient: () => null };
  return {
    cron: new KrSnapshotCron(prisma as never, redis as never, measurer as never),
    prisma,
    measurer,
  };
}

const createdRows = (prisma: ReturnType<typeof make>['prisma']) =>
  prisma.keyResultCheckIn.createMany.mock.calls.flatMap(
    (c) => (c[0] as { data: Array<Record<string, unknown>> }).data,
  );

describe('KrSnapshotCron.snapshotAll (L29)', () => {
  it('KR nhập tay: ghi currentValue, source AUTO, snapshotDate = ngày UTC, createMany skipDuplicates', async () => {
    const { cron, prisma } = make({
      objectives: { w1: [{ id: 'o1', period: '2026-Q4', keyResults: [kr('k1', 'MANUAL', 7)] }] },
    });
    expect(await cron.snapshotAll(NOW)).toBe(1);
    expect(prisma.keyResultCheckIn.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.keyResultCheckIn.createMany.mock.calls[0]![0] as {
      data: unknown[];
      skipDuplicates: boolean;
    };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual([
      { keyResultId: 'k1', value: 7, source: 'AUTO', snapshotDate: TODAY },
    ]);
  });

  it('KR tự đo: ghi số đo theo phạm vi CÔNG KHAI (measure(w, "public", …))', async () => {
    const measured = new Map([['k1', { value: 12, measuredAt: 'x', error: null }]]);
    const { cron, prisma, measurer } = make({
      objectives: { w1: [{ id: 'o1', period: '2026-Q4', keyResults: [kr('k1', 'OPEN_BUGS', 3)] }] },
      measured,
    });
    await cron.snapshotAll(NOW);
    expect(measurer.measure).toHaveBeenCalledWith('w1', 'public', [
      expect.objectContaining({ id: 'k1', source: 'OPEN_BUGS' }),
    ]);
    expect(createdRows(prisma)).toEqual([
      { keyResultId: 'k1', value: 12, source: 'AUTO', snapshotDate: TODAY },
    ]);
  });

  it('chạy lần 2 cùng ngày: KR đã có bản chụp hôm nay không đo lại, không ghi (idempotent)', async () => {
    const { cron, prisma, measurer } = make({
      objectives: {
        w1: [{ id: 'o1', period: '2026-Q4', keyResults: [kr('k1'), kr('k2', 'OPEN_BUGS')] }],
      },
      existing: ['k1', 'k2'],
    });
    expect(await cron.snapshotAll(NOW)).toBe(0);
    expect(measurer.measure).not.toHaveBeenCalled();
    expect(prisma.keyResultCheckIn.createMany).not.toHaveBeenCalled();
    // đã tra đúng ngày UTC
    expect(
      (prisma.keyResultCheckIn.findMany.mock.calls[0]![0] as { where: unknown }).where,
    ).toEqual({ keyResultId: { in: ['k1', 'k2'] }, snapshotDate: TODAY });
  });

  it('chỉ mục tiêu ACTIVE của dự án còn sống và chưa lưu trữ (hoặc cấp workspace)', async () => {
    const { cron, prisma } = make({ objectives: { w1: [] } });
    await cron.snapshotAll(NOW);
    const where = (prisma.objective.findMany.mock.calls[0]![0] as { where: unknown }).where;
    expect(where).toEqual({
      workspaceId: 'w1',
      status: 'ACTIVE',
      OR: [{ projectId: null }, { project: { deletedAt: null, archivedAt: null } }],
      keyResults: { some: {} },
    });
    expect(prisma.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it('kỳ quý: chụp khi đang trong kỳ hoặc ≤ 7 ngày sau; bỏ qua quý đã qua/quý chưa tới; kỳ tự do luôn chụp', async () => {
    const o = (id: string, period: string): Obj => ({ id, period, keyResults: [kr(`k-${id}`)] });
    const { cron, prisma } = make({
      objectives: {
        w1: [
          o('in', '2026-Q4'),
          o('past', '2026-Q2'),
          o('grace', '2026-Q3'), // Q3 hết 30/09 → 16/10 là 16 ngày sau → bỏ
          o('future', '2027-Q1'),
          o('free', 'H2 2026'),
        ],
      },
    });
    await cron.snapshotAll(NOW);
    expect(createdRows(prisma).map((r) => r.keyResultId)).toEqual(['k-in', 'k-free']);
    // trong 7 ngày sau kỳ vẫn chụp
    const g = make({ objectives: { w1: [o('grace', '2026-Q3')] } });
    await g.cron.snapshotAll(new Date('2026-10-07T01:30:00Z'));
    expect(createdRows(g.prisma).map((r) => r.keyResultId)).toEqual(['k-grace']);
  });

  it('KR đo lỗi (value null) không ghi và không làm hỏng KR khác', async () => {
    const measured = new Map([
      ['k1', { value: null, measuredAt: 'x', error: 'JQL không hợp lệ' }],
      ['k2', { value: 5, measuredAt: 'x', error: null }],
    ]);
    const { cron, prisma } = make({
      objectives: {
        w1: [
          {
            id: 'o1',
            period: '2026-Q4',
            keyResults: [kr('k1', 'ISSUE_COUNT_JQL'), kr('k2', 'OPEN_BUGS'), kr('k3')],
          },
        ],
      },
      measured,
    });
    await cron.snapshotAll(NOW);
    expect(createdRows(prisma).map((r) => [r.keyResultId, r.value])).toEqual([
      ['k2', 5],
      ['k3', 3],
    ]);
  });

  it('một workspace lỗi không chặn workspace khác', async () => {
    const { cron, prisma } = make({
      workspaces: ['w1', 'w2'],
      objectives: { w2: [{ id: 'o', period: '2026-Q4', keyResults: [kr('k9')] }] },
    });
    prisma.objective.findMany.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await cron.snapshotAll(NOW);
    expect(createdRows(prisma).map((r) => r.keyResultId)).toEqual(['k9']);
  });
});

describe('KrSnapshotCron + KrMeasureService thật — KR JQL cũ dùng currentUser/me (I1)', () => {
  it('không ghi số 0 giả: bỏ qua KR đó, KR khác vẫn chụp', async () => {
    const search = {
      countPublic: vi.fn(() =>
        Promise.reject(
          new BusinessRuleException('JQL của KR tự đo không được dùng currentUser/me'),
        ),
      ),
    };
    const prisma = {
      workspace: { findMany: vi.fn(() => Promise.resolve([{ id: 'w1' }])) },
      objective: {
        findMany: vi.fn(() =>
          Promise.resolve([
            {
              id: 'o1',
              period: '2026-Q4',
              keyResults: [
                {
                  id: 'kj',
                  source: 'ISSUE_COUNT_JQL',
                  sourceConfig: { jql: 'assignee = me' },
                  currentValue: 0,
                },
                { id: 'km', source: 'MANUAL', sourceConfig: null, currentValue: 4 },
              ],
            },
          ]),
        ),
      },
      keyResultCheckIn: {
        findMany: vi.fn(() => Promise.resolve([])),
        createMany: vi.fn((a: { data: unknown[] }) => Promise.resolve({ count: a.data.length })),
      },
    };
    const measurer = new KrMeasureService({} as never, {} as never, search as never);
    const cron = new KrSnapshotCron(
      prisma as never,
      { isAvailable: () => false, getClient: () => null } as never,
      measurer,
    );
    await cron.snapshotAll(NOW);
    const data = (
      prisma.keyResultCheckIn.createMany.mock.calls[0] as unknown as [
        { data: Array<{ keyResultId: string }> },
      ]
    )[0].data;
    expect(data.map((r) => r.keyResultId)).toEqual(['km']);
  });
});

describe('KrSnapshotCron.runDaily — khoá cron (L29)', () => {
  it('lấy khoá goals:kr-snapshot TTL 1800; nếu khoá của node khác thì không đo', async () => {
    resetCronLockWarning();
    const set = vi.fn(() => Promise.resolve(null as 'OK' | null));
    const redis = {
      isAvailable: () => true,
      getClient: () => ({ set, eval: vi.fn(() => Promise.resolve(1)) }),
    };
    const { cron, prisma, measurer } = make({ redis });
    await cron.runDaily();
    expect(set).toHaveBeenCalledWith(
      'lock:cron:goals:kr-snapshot',
      expect.any(String),
      'EX',
      1800,
      'NX',
    );
    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
    expect(measurer.measure).not.toHaveBeenCalled();
  });

  it('cron khai báo 01:30 UTC', () => {
    const src = readFileSync(join(__dirname, 'kr-snapshot.cron.ts'), 'utf8');
    expect(src).toContain("@Cron('30 1 * * *', { timeZone: 'UTC' })");
  });
});

describe('KrSnapshotCron.snapshotKeyResult (L29)', () => {
  const krRow = (over: Record<string, unknown> = {}) => ({
    id: 'k1',
    source: 'OPEN_BUGS',
    sourceConfig: {},
    currentValue: 3,
    objective: { workspaceId: 'w1', status: 'ACTIVE', project: null },
    ...over,
  });

  it('upsert bản chụp hôm nay theo (keyResultId, snapshotDate) — đổi nguồn giữa ngày thì ghi đè số', async () => {
    const measured = new Map([['k1', { value: 9, measuredAt: 'x', error: null }]]);
    const { cron, prisma, measurer } = make({ measured });
    prisma.keyResult.findFirst.mockResolvedValueOnce(krRow());
    await cron.snapshotKeyResult('k1', NOW);
    expect(measurer.measure).toHaveBeenCalledWith('w1', 'public', [
      expect.objectContaining({ id: 'k1' }),
    ]);
    expect(prisma.keyResultCheckIn.upsert).toHaveBeenCalledWith({
      where: { keyResultId_snapshotDate: { keyResultId: 'k1', snapshotDate: TODAY } },
      create: { keyResultId: 'k1', value: 9, source: 'AUTO', snapshotDate: TODAY },
      update: { value: 9 },
    });
  });

  it('mục tiêu không ACTIVE / dự án đã xoá-lưu trữ / đo lỗi → không ghi', async () => {
    for (const row of [
      krRow({ objective: { workspaceId: 'w1', status: 'CLOSED', project: null } }),
      krRow({
        objective: {
          workspaceId: 'w1',
          status: 'ACTIVE',
          project: { deletedAt: new Date(), archivedAt: null },
        },
      }),
      krRow({
        objective: {
          workspaceId: 'w1',
          status: 'ACTIVE',
          project: { deletedAt: null, archivedAt: new Date() },
        },
      }),
      null,
    ]) {
      const { cron, prisma } = make({});
      prisma.keyResult.findFirst.mockResolvedValueOnce(row);
      await cron.snapshotKeyResult('k1', NOW);
      expect(prisma.keyResultCheckIn.upsert).not.toHaveBeenCalled();
    }
    const failing = make({
      measured: new Map([['k1', { value: null, measuredAt: 'x', error: 'lỗi' }]]),
    });
    failing.prisma.keyResult.findFirst.mockResolvedValueOnce(krRow());
    await failing.cron.snapshotKeyResult('k1', NOW);
    expect(failing.prisma.keyResultCheckIn.upsert).not.toHaveBeenCalled();
  });
});
