import { describe, expect, it, vi } from 'vitest';
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
    ).rollup('w1');
    expect(groupBy).toHaveBeenCalledTimes(3);
    for (const c of groupBy.mock.calls as unknown as [{ where: unknown }][])
      expect(c[0].where).toMatchObject({ workspaceId: 'w1', project: { deletedAt: null } });
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
    const r = await service.rollup('w1');
    const [p1, p2] = r.groups[0]!.projects;
    expect(p1).toMatchObject({ key: 'AAA', health: HEALTH });
    expect(p2).toMatchObject({ key: 'BBB', health: null });
    expect(health.forProjects).toHaveBeenCalledTimes(1);
    expect(health.forProjects).toHaveBeenCalledWith('w1', ['p1'], undefined);
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
