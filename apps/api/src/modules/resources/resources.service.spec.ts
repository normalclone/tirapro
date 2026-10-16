import { describe, expect, it, vi } from 'vitest';
import { ResourcesService } from './resources.service';

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
      await service.workload('w1', { projectId });
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

  it('listAllocations không viewer (hệ thống) → không lọc', async () => {
    const { service, prisma, access } = make();
    await service.listAllocations('w1', {});
    expect(access.visibleWhere).not.toHaveBeenCalled();
    expect(JSON.stringify(whereOf(prisma.allocation.findMany))).not.toContain('isPrivate');
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
