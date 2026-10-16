import { describe, expect, it, vi } from 'vitest';
import { ProjectAccessService } from '../rbac/project-access.service';
import { ProgramsService } from './programs.service';

/** ProjectAccessService giả: người xem thấy mọi dự án (admin) / không có viewer. */
const ACCESS_ALL = { visibleWhere: vi.fn(() => Promise.resolve({})) };

describe('ProgramsService.rollup — bỏ issue của dự án xoá mềm', () => {
  it('cả ba groupBy issue có project.deletedAt:null', async () => {
    const groupBy = vi.fn(() => Promise.resolve([]));
    const prisma = {
      program: { findMany: vi.fn(() => Promise.resolve([])) },
      project: { findMany: vi.fn(() => Promise.resolve([])) },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
      issue: { groupBy },
    };
    await new ProgramsService(
      prisma as never,
      { forProjects: vi.fn(() => Promise.resolve(new Map())) } as never,
      ACCESS_ALL as never,
    ).rollup('w1', 'u0');
    expect(groupBy).toHaveBeenCalledTimes(3);
    for (const c of groupBy.mock.calls as unknown as [{ where: unknown }][])
      expect(c[0].where).toMatchObject({ workspaceId: 'w1', project: { deletedAt: null } });
  });
});

describe('ProgramsService.rollup — quá hạn theo ngày VN', () => {
  it('groupBy quá hạn dùng dueDate < đầu ngày VN (hạn hôm nay chưa quá hạn)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z')); // 09:00 VN
    try {
      const groupBy = vi.fn(() => Promise.resolve([]));
      const prisma = {
        program: { findMany: vi.fn(() => Promise.resolve([])) },
        project: { findMany: vi.fn(() => Promise.resolve([])) },
        status: { findMany: vi.fn(() => Promise.resolve([])) },
        issue: { groupBy },
      };
      await new ProgramsService(
        prisma as never,
        { forProjects: vi.fn(() => Promise.resolve(new Map())) } as never,
        ACCESS_ALL as never,
      ).rollup('w1', 'u0');
      const wheres = (groupBy.mock.calls as unknown as [{ where: { dueDate?: { lt: Date } } }][])
        .map((c) => c[0].where)
        .filter((w) => w.dueDate);
      expect(wheres).toHaveLength(1);
      expect(wheres[0]!.dueDate!.lt.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ProgramsService.rollup — sức khoẻ dự án', () => {
  const HEALTH = {
    level: 'RED',
    auto: { level: 'RED', reasons: ['3/9 việc chưa xong đang quá hạn'] },
    override: null,
  };

  function make() {
    const prisma = {
      program: { findMany: vi.fn(() => Promise.resolve([])) },
      project: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { id: 'p1', key: 'AAA', name: 'Alpha', isArchived: false, programId: null, lead: null },
            { id: 'p2', key: 'BBB', name: 'Beta', isArchived: true, programId: null, lead: null },
          ]),
        ),
      },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
      issue: { groupBy: vi.fn(() => Promise.resolve([])) },
    };
    const health = {
      forProjects: vi.fn((_w: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, HEALTH]))),
      ),
    };
    return {
      service: new ProgramsService(prisma as never, health as never, ACCESS_ALL as never),
      health,
    };
  }

  it('mỗi dự án đang hoạt động có `health`; dự án lưu trữ có health = null và không bị tính', async () => {
    const { service, health } = make();
    const r = await service.rollup('w1', 'u0');
    const [p1, p2] = r.groups[0]!.projects;
    expect(p1).toMatchObject({ key: 'AAA', health: HEALTH });
    expect(p2).toMatchObject({ key: 'BBB', health: null });
    expect(health.forProjects).toHaveBeenCalledTimes(1);
    expect(health.forProjects).toHaveBeenCalledWith('w1', ['p1'], 'u0');
  });
});

describe('ProgramsService — dự án riêng tư (P14)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const whereOf = (fn: ReturnType<typeof vi.fn>, i = 0) =>
    (fn.mock.calls[i] as unknown as [{ where: unknown }])[0].where;

  function make(over: { found?: { id: string }[] } = {}) {
    const prisma = {
      program: {
        findMany: vi.fn(() =>
          Promise.resolve([
            {
              id: 'g1',
              name: 'G',
              color: null,
              description: null,
              startDate: null,
              targetDate: null,
              owner: null,
              workspaceId: 'w1',
              createdAt: new Date(),
              projects: [],
            },
          ]),
        ),
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: 'g1',
            name: 'G',
            workspaceId: 'w1',
            description: null,
            color: null,
            startDate: null,
            targetDate: null,
            createdAt: new Date(),
            owner: null,
            projects: [],
          }),
        ),
      },
      project: {
        findMany: vi.fn((a: { select?: { programId?: boolean } }) =>
          Promise.resolve(a.select?.programId ? [] : (over.found ?? [])),
        ),
        updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
      issue: { groupBy: vi.fn(() => Promise.resolve([])) },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const health = { forProjects: vi.fn(() => Promise.resolve(new Map())) };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visible)) };
    const service = new ProgramsService(prisma as never, health as never, access as never);
    return { service, prisma, access, health };
  }

  it('rollup(w, viewer): project.findMany và cả ba groupBy issue chỉ gồm dự án người xem thấy', async () => {
    const { service, prisma, access, health } = make();
    await service.rollup('w1', 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    // Sức khoẻ (có tiêu đề RAID ở reasons + ghi chú ghi đè của PM) chỉ tính cho dự án đã lọc và truyền người xem tiếp.
    expect(health.forProjects).toHaveBeenCalledWith('w1', [], 'u1');
    expect(whereOf(prisma.project.findMany)).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      ...visible,
    });
    expect(prisma.issue.groupBy).toHaveBeenCalledTimes(3);
    for (const c of prisma.issue.groupBy.mock.calls as unknown as [{ where: unknown }][])
      expect(c[0].where).toMatchObject({ project: { deletedAt: null, ...visible } });
  });

  it('rollup: chương trình vẫn hiện dù không còn dự án nào thấy được (tổng chỉ của dự án thấy được)', async () => {
    const { service } = make();
    const r = await service.rollup('w1', 'u1');
    expect(r.totals.scoped).toBe(true);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ id: 'g1', projectCount: 0, issueCount: 0 });
    expect(r.totals).toMatchObject({ projectCount: 0, programCount: 1 });
  });

  it('list/get(…, viewer): danh sách dự án con của chương trình chỉ gồm dự án thấy được', async () => {
    const { service, prisma } = make();
    await service.list('w1', 'u1');
    await service.get('w1', 'g1', 'u1');
    for (const fn of [prisma.program.findMany, prisma.program.findFirst]) {
      const sel = (fn.mock.calls[0] as unknown as [{ select: { projects: { where: unknown } } }])[0]
        .select;
      expect(sel.projects.where).toMatchObject({ deletedAt: null, ...visible });
    }
  });

  it('setProjects: dự án người gọi không thấy → BusinessRuleException (cùng lỗi với dự án ngoài workspace), không ghi', async () => {
    const { service, prisma } = make({ found: [] });
    await expect(service.setProjects('w1', 'g1', ['hidden'], 'u1')).rejects.toMatchObject({
      status: 422,
    });
    expect(whereOf(prisma.project.findMany)).toMatchObject({
      id: { in: ['hidden'] },
      workspaceId: 'w1',
      ...visible,
    });
    expect(prisma.project.updateMany).not.toHaveBeenCalled();
  });

  it('setProjects: thành viên gán được dự án riêng tư; gỡ chỉ động tới dự án người gọi thấy (không gỡ dự án ẩn)', async () => {
    const { service, prisma } = make({ found: [{ id: 'p1' }] });
    await service.setProjects('w1', 'g1', ['p1'], 'u1');
    const unlink = (prisma.project.updateMany.mock.calls[0] as unknown as [{ where: unknown }])[0]
      .where;
    expect(unlink).toMatchObject({ workspaceId: 'w1', programId: 'g1', ...visible });
    expect(prisma.project.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('ProgramsService.rollup — ProjectAccessService THẬT trên dữ liệu giả (thành viên thấy / người ngoài không)', () => {
  type Row = { id: string; key: string; isPrivate: boolean; members: string[] };
  const rows: Row[] = [
    { id: 'p-pub', key: 'PUB', isPrivate: false, members: [] },
    { id: 'p-hr', key: 'HR', isPrivate: true, members: ['u-member'] },
    { id: 'p-fin', key: 'FIN', isPrivate: true, members: ['u-other'] },
  ];
  /** Đánh giá `where` của Project: hỗ trợ đúng các dạng mà ProjectAccessService sinh ra. */
  const matches = (w: Record<string, unknown>, r: Row, userId: string): boolean => {
    if ('OR' in w) return (w.OR as Record<string, unknown>[]).some((x) => matches(x, r, userId));
    if ('isPrivate' in w) return w.isPrivate === r.isPrivate;
    if ('memberships' in w) return r.members.includes(userId);
    return true;
  };

  function run(userId: string) {
    const rbac = { projectVisibilityMode: vi.fn(() => Promise.resolve('standard')) };
    const access = new ProjectAccessService({} as never, rbac as never);
    let viewer = userId;
    const prisma = {
      program: { findMany: vi.fn(() => Promise.resolve([])) },
      project: {
        findMany: vi.fn((a: { where: Record<string, unknown> }) =>
          Promise.resolve(
            rows
              .filter((r) => matches(a.where, r, viewer))
              .map((r) => ({
                id: r.id,
                key: r.key,
                name: r.key,
                isArchived: false,
                programId: null,
                lead: null,
              })),
          ),
        ),
      },
      status: { findMany: vi.fn(() => Promise.resolve([])) },
      issue: { groupBy: vi.fn(() => Promise.resolve([])) },
    };
    viewer = userId;
    const health = { forProjects: vi.fn(() => Promise.resolve(new Map())) };
    return new ProgramsService(prisma as never, health as never, access).rollup('w1', userId);
  }

  it('thành viên dự án riêng tư thấy dự án đó; người ngoài chỉ thấy dự án công khai', async () => {
    const member = await run('u-member');
    expect(member.groups.flatMap((g) => g.projects.map((p) => p.key)).sort()).toEqual([
      'HR',
      'PUB',
    ]);
    const outsider = await run('u-nobody');
    expect(outsider.groups.flatMap((g) => g.projects.map((p) => p.key))).toEqual(['PUB']);
    expect(outsider.totals.projectCount).toBe(1);
  });
});
