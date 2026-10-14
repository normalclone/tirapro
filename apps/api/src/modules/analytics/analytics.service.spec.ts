import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service';

/** Ghép chuỗi SQL từ lời gọi tagged template của $queryRaw (strings, ...values). */
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?');
const paramsOf = (call: unknown[]) => call.slice(1);

describe('AnalyticsService.projectReport — aggregate SQL', () => {
  const statuses = [
    { id: 's-todo', name: 'To Do', category: 'TODO', order: 0 },
    { id: 's-prog', name: 'In Progress', category: 'IN_PROGRESS', order: 1 },
    { id: 's-done', name: 'Done', category: 'DONE', order: 2 },
  ];
  const sum = (p: number | null) => ({ storyPoints: p });

  function make() {
    const rows = (args: { by: string[] }) => {
      const by = args.by.join(',');
      if (by === 'statusId') {
        return [
          { statusId: 's-todo', _count: { _all: 3 }, _sum: sum(5) },
          { statusId: 's-prog', _count: { _all: 2 }, _sum: sum(8) },
          { statusId: 's-done', _count: { _all: 5 }, _sum: sum(13) },
        ];
      }
      if (by === 'typeId') {
        return [
          { typeId: 't-task', _count: { _all: 7 } },
          { typeId: 't-bug', _count: { _all: 3 } },
        ];
      }
      if (by === 'priorityId') {
        return [
          { priorityId: 'p-high', _count: { _all: 4 } },
          { priorityId: null, _count: { _all: 6 } },
        ];
      }
      if (by === 'assigneeId,statusId') {
        return [
          { assigneeId: 'u1', statusId: 's-prog', _count: { _all: 2 }, _sum: sum(8) },
          { assigneeId: 'u1', statusId: 's-done', _count: { _all: 3 }, _sum: sum(8) },
          { assigneeId: null, statusId: 's-todo', _count: { _all: 3 }, _sum: sum(5) },
          { assigneeId: 'u2', statusId: 's-done', _count: { _all: 2 }, _sum: sum(5) },
        ];
      }
      if (by === 'assigneeId') {
        return [
          { assigneeId: 'u1', _count: { _all: 1 } },
          { assigneeId: null, _count: { _all: 1 } },
        ];
      }
      throw new Error(`groupBy bất ngờ: ${by}`);
    };
    const groupBy = vi.fn((args: { by: string[]; where?: unknown }) => Promise.resolve(rows(args)));
    const count = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(4);
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(({ id: 'p1' }))) },
      issue: { groupBy, count },
      status: { findMany: vi.fn(() => Promise.resolve(statuses)) },
      issueType: {
        findMany: vi.fn(() => Promise.resolve([
          { id: 't-task', name: 'Task', color: '#0af' },
          { id: 't-bug', name: 'Bug', color: '#f00' },
        ])),
      },
      priority: { findMany: vi.fn(() => Promise.resolve([{ id: 'p-high', name: 'High', color: '#f80', rank: 4 }])) },
      user: {
        findMany: vi.fn(() => Promise.resolve([
          { id: 'u1', displayName: 'An' },
          { id: 'u2', displayName: 'Bình' },
        ])),
      },
    };
    return { service: new AnalyticsService(prisma as never), prisma, groupBy, count };
  }

  it('không kéo từng issue: chỉ dùng groupBy/count, không findMany issue', async () => {
    const { service, prisma } = make();
    await service.projectReport('w1', 'p1');
    expect(prisma.issue).not.toHaveProperty('findMany');
    const bys = prisma.issue.groupBy.mock.calls.map((c) => c[0].by.join(','));
    expect(bys).toEqual(['statusId', 'typeId', 'priorityId', 'assigneeId,statusId', 'assigneeId']);
    // mọi truy vấn đều bị chặn theo project + chưa xoá mềm
    for (const c of prisma.issue.groupBy.mock.calls) {
      expect(c[0].where).toMatchObject({ projectId: 'p1', deletedAt: null });
    }
  });

  it('giữ nguyên hình dạng response cũ từ cùng một fixture', async () => {
    const { service } = make();
    const r = await service.projectReport('w1', 'p1');
    expect(r.totals).toEqual({ total: 10, todo: 3, inProgress: 2, done: 5, overdue: 2, unassigned: 3, points: 26 });
    expect(r.completionRate).toBe(50);
    expect(r.highPriUnassigned).toBe(2);
    expect(r.dueSoon).toBe(4);
    expect(r.byStatus).toEqual([
      { name: 'To Do', count: 3, color: 'var(--status-todo)' },
      { name: 'In Progress', count: 2, color: 'var(--status-progress)' },
      { name: 'Done', count: 5, color: 'var(--status-done)' },
    ]);
    expect(r.byType).toEqual([
      { name: 'Task', color: '#0af', count: 7 },
      { name: 'Bug', color: '#f00', count: 3 },
    ]);
    // byPriority: rank giảm dần, 'Chưa đặt' (rank -1) cuối, không lộ trường rank
    expect(r.byPriority).toEqual([
      { name: 'High', color: '#f80', count: 4 },
      { name: 'Chưa đặt', color: null, count: 6 },
    ]);
    // byAssignee: nhiều việc chưa xong lên trước, "Chưa gán" luôn cuối
    expect(r.byAssignee).toEqual([
      { id: 'u1', name: 'An', total: 5, inProgress: 2, done: 3, overdue: 1, points: 16 },
      { id: 'u2', name: 'Bình', total: 2, inProgress: 0, done: 2, overdue: 0, points: 5 },
      { id: null, name: 'Chưa gán', total: 3, inProgress: 0, done: 0, overdue: 1, points: 5 },
    ]);
  });

  it('project không thuộc workspace => 404', async () => {
    const { service, prisma } = make();
    prisma.project.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.projectReport('w1', 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('AnalyticsService.workspaceOverview — aggregate SQL', () => {
  const NOW = new Date('2026-10-15T12:00:00.000Z');
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const DAY = 24 * 3600 * 1000;

  function make() {
    const rows = (args: { by: string[] }) => {
      const by = args.by.join(',');
      if (by === 'projectId,statusId') {
        return [
          { projectId: 'p1', statusId: 's-todo', _count: { _all: 2 } },
          { projectId: 'p1', statusId: 's-done', _count: { _all: 3 } },
          { projectId: 'p2', statusId: 's-prog', _count: { _all: 1 } },
          { projectId: 'archived', statusId: 's-todo', _count: { _all: 4 } }, // project đã lưu trữ
        ];
      }
      if (by === 'projectId,typeId') {
        return [
          { projectId: 'p1', typeId: 't-bug', _count: { _all: 2 } },
          { projectId: 'p1', typeId: 't-task', _count: { _all: 3 } },
          { projectId: 'p2', typeId: 't-task', _count: { _all: 1 } },
          { projectId: 'archived', typeId: 't-bug', _count: { _all: 4 } },
        ];
      }
      if (by === 'priorityId') {
        return [
          { priorityId: 'p-high', _count: { _all: 5 } },
          { priorityId: null, _count: { _all: 5 } },
        ];
      }
      if (by === 'projectId') return [{ projectId: 'p1', _count: { _all: 2 } }];
      throw new Error(`groupBy bất ngờ: ${by}`);
    };
    const groupBy = vi.fn((args: { by: string[]; where?: unknown }) => Promise.resolve(rows(args)));
    // Thứ tự count khớp thứ tự trong Promise.all của service.
    const count = vi.fn()
      .mockResolvedValueOnce(6) // resolvedLast14
      .mockResolvedValueOnce(3) // unassignedNotDone
      .mockResolvedValueOnce(1) // highPriUnassigned
      .mockResolvedValueOnce(2); // dueSoon
    const findMany = vi.fn()
      .mockResolvedValueOnce([
        { key: 'A-1', summary: 'Trễ 2 ngày', projectId: 'p1', dueDate: new Date(NOW.getTime() - 1.5 * DAY) },
        { key: 'A-2', summary: 'Trễ 5 ngày', projectId: 'p2', dueDate: new Date(NOW.getTime() - 5 * DAY) },
      ])
      .mockResolvedValueOnce([{ key: 'A-3', summary: 'Ưu tiên cao', projectId: 'p1', dueDate: null }])
      .mockResolvedValueOnce([{ key: 'A-4', summary: 'Sắp hạn', projectId: 'p2', dueDate: new Date(NOW.getTime() + 1.2 * DAY) }]);
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ idx: 0, n: 3n }, { idx: 7, n: 1n }, { idx: 9, n: 50n }]) // created (idx 9 bị loại)
      .mockResolvedValueOnce([{ idx: 0, n: 2n }]); // resolved
    const prisma = {
      project: {
        findMany: vi.fn(() => Promise.resolve([
          { id: 'p1', key: 'AAA', name: 'Alpha' },
          { id: 'p2', key: 'BBB', name: 'Beta' },
        ])),
      },
      sprint: { findMany: vi.fn(() => Promise.resolve([{ projectId: 'p1', name: 'Sprint 1', endDate: new Date(NOW.getTime() + 2.5 * DAY), sequence: 1 }])) },
      issue: { groupBy, count, findMany },
      status: {
        findMany: vi.fn(() => Promise.resolve([
          { id: 's-todo', category: 'TODO' },
          { id: 's-prog', category: 'IN_PROGRESS' },
          { id: 's-done', category: 'DONE' },
        ])),
      },
      issueType: {
        findMany: vi.fn(() => Promise.resolve([
          { id: 't-bug', key: 'BUG', name: 'Bug', color: '#f00' },
          { id: 't-task', key: 'TASK', name: 'Task', color: '#0af' },
        ])),
      },
      priority: { findMany: vi.fn(() => Promise.resolve([{ id: 'p-high', name: 'High', color: '#f80', rank: 4 }])) },
      $queryRaw: queryRaw,
    };
    return { service: new AnalyticsService(prisma as never), prisma, queryRaw };
  }

  it('totals gồm cả project lưu trữ, byProject chỉ gồm project đang hiển thị', async () => {
    const { service } = make();
    const r = await service.workspaceOverview('w1');
    expect(r.projectCount).toBe(2);
    expect(r.totals).toEqual({ total: 10, todo: 6, inProgress: 1, done: 3, overdue: 2, bug: 6 });
    expect(r.projects).toEqual([
      { id: 'p1', key: 'AAA', name: 'Alpha', total: 5, todo: 2, inProgress: 0, done: 3, overdue: 2, bug: 2, sprint: { name: 'Sprint 1', daysLeft: 3 } },
      { id: 'p2', key: 'BBB', name: 'Beta', total: 1, todo: 0, inProgress: 1, done: 0, overdue: 0, bug: 0, sprint: null },
    ]);
  });

  it('byType/byPriority/trend/warnings/attention giữ đúng hình dạng cũ', async () => {
    const { service } = make();
    const r = await service.workspaceOverview('w1');
    expect(r.byType).toEqual([
      { name: 'Bug', color: '#f00', count: 6 },
      { name: 'Task', color: '#0af', count: 4 },
    ]);
    expect(r.byPriority).toEqual([
      { name: 'High', color: '#f80', count: 5 },
      { name: 'Chưa đặt', color: null, count: 5 },
    ]);
    expect(r.trend).toHaveLength(8);
    expect(r.trend[0]).toMatchObject({ created: 1, resolved: 0 }); // idx 7 = tuần xa nhất = bucket 0
    expect(r.trend[7]).toMatchObject({ created: 3, resolved: 2 }); // idx 0 = tuần hiện tại = bucket 7
    expect(r.warnings.map((w) => w.level)).toEqual(['danger', 'warning', 'warning', 'info']);
    expect(r.warnings[0]!.text).toContain('2 công việc đã quá hạn');
    expect(r.forecast[0]!.text).toContain('Đã hoàn thành 3/10 việc (30%). Còn 7 việc chưa xong.');
    // 6 việc/14 ngày => 3 việc/tuần => ceil(7/3) = 3 tuần
    expect(r.forecast[1]!.text).toContain('~3.0 việc/tuần');
    expect(r.forecast[1]!.text).toContain('~3 tuần');
    expect(r.attention).toEqual([
      { key: 'A-2', summary: 'Trễ 5 ngày', projectKey: 'BBB', reason: 'Quá hạn 5 ngày', level: 'danger' },
      { key: 'A-1', summary: 'Trễ 2 ngày', projectKey: 'AAA', reason: 'Quá hạn 2 ngày', level: 'danger' },
      { key: 'A-3', summary: 'Ưu tiên cao', projectKey: 'AAA', reason: 'Ưu tiên cao, chưa gán người', level: 'warning' },
      { key: 'A-4', summary: 'Sắp hạn', projectKey: 'BBB', reason: 'Sắp đến hạn (2 ngày)', level: 'warning' },
    ]);
  });

  it('không kéo từng issue + câu raw xu hướng bind tham số, không nội suy chuỗi', async () => {
    const { service, prisma, queryRaw } = make();
    await service.workspaceOverview('w1');
    const bys = prisma.issue.groupBy.mock.calls.map((c) => c[0].by.join(','));
    expect(bys).toEqual(['projectId,statusId', 'projectId,typeId', 'priorityId', 'projectId']);
    // findMany của issue chỉ cho danh sách "cần chú ý" và luôn có take 8
    for (const c of prisma.issue.findMany.mock.calls) expect((c[0] as { take: number }).take).toBe(8);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const call of queryRaw.mock.calls) {
      const sql = sqlOf(call);
      expect(sql).toContain('GROUP BY');
      expect(sql).not.toContain('w1');
      expect(paramsOf(call)).toContain('w1');
    }
    expect(sqlOf(queryRaw.mock.calls[0]!)).toContain('"createdAt"');
    expect(sqlOf(queryRaw.mock.calls[1]!)).toContain('"resolvedAt"');
  });
});

describe('AnalyticsService.cfd — delta từ IssueHistory', () => {
  function make(before: unknown[], inRange: unknown[]) {
    const queryRaw = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(inRange);
    const prisma = { project: { findFirst: vi.fn(() => Promise.resolve(({ id: 'p1' }))) }, $queryRaw: queryRaw };
    return { service: new AnalyticsService(prisma as never), queryRaw };
  }

  it('dựng trạng thái đầu kỳ rồi cộng/trừ delta theo ngày', async () => {
    const { service, queryRaw } = make(
      [
        { oldCategory: null, newCategory: 'TODO', n: 5n },
        { oldCategory: 'TODO', newCategory: 'IN_PROGRESS', n: 1n },
      ],
      [
        { day: '2026-10-02', oldCategory: 'TODO', newCategory: 'IN_PROGRESS', n: 2n },
        { day: '2026-10-02', oldCategory: null, newCategory: 'TODO', n: 1n },
        { day: '2026-10-03', oldCategory: 'IN_PROGRESS', newCategory: 'DONE', n: 1n },
        // đổi trạng thái trong cùng category: tự triệt tiêu
        { day: '2026-10-03', oldCategory: 'IN_PROGRESS', newCategory: 'IN_PROGRESS', n: 4n },
      ],
    );
    const r = await service.cfd('w1', 'p1', '2026-10-01', '2026-10-03');
    expect(r.from).toBe('2026-10-01');
    expect(r.to).toBe('2026-10-03');
    expect(r.series).toEqual([
      { date: '2026-10-01', todo: 4, inProgress: 1, done: 0 },
      { date: '2026-10-02', todo: 3, inProgress: 3, done: 0 },
      { date: '2026-10-03', todo: 3, inProgress: 2, done: 1 },
    ]);

    // Cả hai câu đều lọc theo project + field STATUS, tham số bind (không nội suy).
    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const call of queryRaw.mock.calls) {
      const sql = sqlOf(call);
      expect(sql).toContain('FROM "IssueHistory"');
      expect(sql).toContain(`"field" = 'STATUS'`);
      expect(sql).toContain('GROUP BY');
      expect(paramsOf(call)).toContain('p1');
      expect(sql).not.toContain('p1');
    }
    const [lo] = paramsOf(queryRaw.mock.calls[0]!).slice(1) as Date[];
    expect(lo!.toISOString()).toBe('2026-10-01T00:00:00.000Z'); // "trước from" dùng đúng biên đầu ngày UTC
    const [lo2, hi2] = paramsOf(queryRaw.mock.calls[1]!).slice(1) as Date[];
    expect(lo2!.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(hi2!.toISOString()).toBe('2026-10-03T23:59:59.999Z');
  });

  it('không có sự kiện nào => toàn số 0', async () => {
    const { service } = make([], []);
    const r = await service.cfd('w1', 'p1', '2026-10-01', '2026-10-02');
    expect(r.series).toEqual([
      { date: '2026-10-01', todo: 0, inProgress: 0, done: 0 },
      { date: '2026-10-02', todo: 0, inProgress: 0, done: 0 },
    ]);
  });
});

describe('AnalyticsService.createdResolved — đếm theo ngày bằng SQL', () => {
  it('điền 0 cho ngày trống và chuyển bigint sang number', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ day: '2026-10-01', n: 2n }, { day: '2026-10-03', n: 1n }]) // created
      .mockResolvedValueOnce([{ day: '2026-10-02', n: 4n }]); // resolved
    const prisma = { project: { findFirst: vi.fn(() => Promise.resolve(({ id: 'p1' }))) }, $queryRaw: queryRaw };
    const service = new AnalyticsService(prisma as never);
    const r = await service.createdResolved('w1', 'p1', '2026-10-01', '2026-10-03');
    expect(r.series).toEqual([
      { date: '2026-10-01', created: 2, resolved: 0 },
      { date: '2026-10-02', created: 0, resolved: 4 },
      { date: '2026-10-03', created: 1, resolved: 0 },
    ]);
    expect(sqlOf(queryRaw.mock.calls[0]!)).toContain('FROM "Issue"');
    expect(sqlOf(queryRaw.mock.calls[0]!)).toContain('"deletedAt" IS NULL');
    expect(sqlOf(queryRaw.mock.calls[1]!)).toContain(`"newCategory" = 'DONE'`);
    for (const call of queryRaw.mock.calls) expect(paramsOf(call)).toContain('p1');
  });
});
