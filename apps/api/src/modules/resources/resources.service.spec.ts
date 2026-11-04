import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourcesService } from './resources.service';
import { hasTriageVisible } from '../../common/triage-visibility.testutil';

/** ProjectAccessService giả: người xem thấy mọi dự án (admin) / không có viewer. */
const ACCESS_ALL = { visibleWhere: vi.fn(() => Promise.resolve({})) };

describe('ResourcesService.workload — bỏ issue/worklog của dự án xoá mềm', () => {
  it('issue.findMany và workLog.findMany có project.deletedAt:null (cả khi lọc theo projectId)', async () => {
    const empty = () => vi.fn(() => Promise.resolve([]));
    const prisma = {
      workspaceMembership: {
        findMany: vi.fn(() =>
          Promise.resolve([{ user: { id: 'u1', displayName: 'An', email: 'a@x.vn' } }]),
        ),
      },
      allocation: { findMany: empty() },
      timeOff: { findMany: empty() },
      issue: { findMany: empty() },
      workLog: { findMany: empty() },
    };
    const service = new ResourcesService(prisma as never, ACCESS_ALL as never);
    for (const projectId of [undefined, 'p1']) {
      prisma.issue.findMany.mockClear();
      prisma.workLog.findMany.mockClear();
      await service.workload('w1', { projectId }, 'u0');
      const issueWhere = (prisma.issue.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0]
        .where;
      const logWhere = (
        prisma.workLog.findMany.mock.calls[0] as unknown as [{ where: { issue: unknown } }]
      )[0].where.issue;
      expect(issueWhere).toMatchObject({
        workspaceId: 'w1',
        deletedAt: null,
        project: { deletedAt: null },
      });
      expect(logWhere).toMatchObject({
        workspaceId: 'w1',
        deletedAt: null,
        project: { deletedAt: null },
      });
      if (projectId) {
        expect(issueWhere).toMatchObject({ projectId });
        expect(logWhere).toMatchObject({ projectId });
      }
    }
  });
});

describe('ResourcesService — dự án riêng tư (P14)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const whereOf = (fn: ReturnType<typeof vi.fn>, i = 0) =>
    (fn.mock.calls[i] as unknown as [{ where: unknown }])[0].where;

  function make() {
    const empty = () => vi.fn((_a?: unknown) => Promise.resolve([]));
    const prisma = {
      workspaceMembership: {
        findMany: vi.fn(() =>
          Promise.resolve([{ user: { id: 'u1', displayName: 'An', email: 'a@x.vn' } }]),
        ),
        findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })),
      },
      allocation: {
        findMany: empty(),
        findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)),
        create: vi.fn(() => Promise.resolve({})),
      },
      timeOff: { findMany: empty() },
      issue: { findMany: empty() },
      workLog: { findMany: empty() },
      project: { findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)) },
    };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visible)) };
    return { service: new ResourcesService(prisma as never, access as never), prisma, access };
  }

  it('listAllocations(w, q, viewer): where.project chứa điều kiện hiển thị', async () => {
    const { service, prisma, access } = make();
    await service.listAllocations('w1', {}, 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(whereOf(prisma.allocation.findMany)).toMatchObject({
      project: { workspaceId: 'w1', deletedAt: null, ...visible },
    });
  });

  it('workload(w, q, viewer): phân bổ, issue và worklog của dự án ẩn bị bỏ khỏi tổng', async () => {
    const { service, prisma } = make();
    await service.workload('w1', {}, 'u1');
    expect(whereOf(prisma.allocation.findMany)).toMatchObject({
      project: { workspaceId: 'w1', deletedAt: null, ...visible },
    });
    expect(whereOf(prisma.issue.findMany)).toMatchObject({
      project: { deletedAt: null, ...visible },
    });
    const log = (
      prisma.workLog.findMany.mock.calls[0] as unknown as [{ where: { issue: unknown } }]
    )[0].where.issue;
    expect(log).toMatchObject({ project: { deletedAt: null, ...visible } });
  });

  it('create/update/delete phân bổ: dự án riêng tư không thấy → 404 (như không tồn tại)', async () => {
    const { service, prisma } = make();
    await expect(
      service.createAllocation(
        'w1',
        { projectId: 'hr', userId: 'u1', startDate: '2026-10-01', endDate: '2026-10-10' } as never,
        'u1',
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(whereOf(prisma.project.findFirst)).toMatchObject({ id: 'hr', ...visible });
    await expect(service.updateAllocation('w1', 'a1', { percent: 50 }, 'u1')).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    await expect(service.deleteAllocation('w1', 'a1', 'u1')).rejects.toMatchObject({ status: 404 });
    for (const i of [0, 1])
      expect(whereOf(prisma.allocation.findFirst, i)).toMatchObject({
        id: 'a1',
        project: { workspaceId: 'w1', deletedAt: null, ...visible },
      });
    expect(prisma.allocation.create).not.toHaveBeenCalled();
  });
});

describe('ResourcesService.workload — việc chưa duyệt không tính vào tải', () => {
  it('issue.findMany lọc TRIAGE_VISIBLE mà không đè khoá OR theo khoảng ngày', async () => {
    const empty = () => vi.fn(() => Promise.resolve([]));
    const prisma = {
      workspaceMembership: {
        findMany: vi.fn(() =>
          Promise.resolve([{ user: { id: 'u1', displayName: 'An', email: 'a@x.vn' } }]),
        ),
      },
      allocation: { findMany: empty() },
      timeOff: { findMany: empty() },
      issue: { findMany: empty() },
      workLog: { findMany: empty() },
    };
    await new ResourcesService(prisma as never, ACCESS_ALL as never).workload('w1', {}, 'u0');
    const where = (prisma.issue.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where;
    expect(hasTriageVisible(where)).toBe(true);
    // khoảng ngày (OR gốc) vẫn còn
    expect(JSON.stringify(where)).toContain('"startDate"');
  });
});

describe('ResourcesService.workload — điểm Epic không quy ra giờ (đếm đôi với việc con)', () => {
  // Cố định "hôm nay" là một ngày làm việc (thứ Tư 04/11/2026) để giờ đã giao không phụ thuộc ngày chạy test.
  const day = new Date('2026-11-04T05:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(day);
  });
  afterEach(() => vi.useRealTimers());

  /** Tổng giờ đã giao của mọi tuần/người (số việc `issueCount` vẫn tính cả Epic nên không so sánh). */
  const assigned = async (issues: unknown[]) =>
    (await run(issues)).rows.flatMap((r) => r.weeks).reduce((a, w) => a + w.assignedHours, 0);
  const run = (issues: unknown[]) => {
    const empty = () => vi.fn(() => Promise.resolve([]));
    const prisma = {
      workspaceMembership: {
        findMany: vi.fn(() =>
          Promise.resolve([{ user: { id: 'u1', displayName: 'An', email: 'a@x.vn' } }]),
        ),
      },
      allocation: { findMany: empty() },
      timeOff: { findMany: empty() },
      issue: { findMany: vi.fn(() => Promise.resolve(issues)) },
      workLog: { findMany: empty() },
    };
    return new ResourcesService(prisma as never, ACCESS_ALL as never).workload('w1', {}, 'u0');
  };
  const issue = (
    key: string | null,
    storyPoints: number,
    originalEstimate: number | null = null,
    childCount = 0,
  ) => ({
    assigneeId: 'u1',
    startDate: day,
    dueDate: day,
    originalEstimate,
    storyPoints,
    type: { key },
    _count: { children: childCount },
  });

  it('Epic (điểm = tổng việc con) thêm vào cùng người/tuần không làm tăng giờ đã giao', async () => {
    const task = issue('TASK', 5);
    const alone = await assigned([task]);
    expect(alone).toBeGreaterThan(0);
    expect(await assigned([task, issue('EPIC', 5)])).toBe(alone);
    // đối chứng: thêm một Task cùng điểm thì giờ đã giao phải tăng (bài kiểm tra có răng)
    expect(await assigned([task, issue('TASK', 5)])).toBeGreaterThan(alone);
  });

  it('việc cha có việc con (điểm = tổng việc con) không quy ra giờ — chỉ việc lá được tính tải', async () => {
    const leaf = issue('TASK', 5);
    const alone = await assigned([leaf]);
    expect(await assigned([leaf, issue('TASK', 5, null, 2)])).toBe(alone);
  });

  it('Epic có ước lượng thời gian riêng (originalEstimate) vẫn được tính giờ đó', async () => {
    expect(await assigned([issue('EPIC', 99)])).toBe(0);
    expect(await assigned([issue('EPIC', 99, 4 * 3600)])).toBeGreaterThan(0);
  });
});
