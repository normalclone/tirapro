import { describe, expect, it, vi } from 'vitest';
import { ProjectHealthService } from './project-health.service';

interface GroupArgs {
  by: string[];
  where: Record<string, unknown>;
}

function make() {
  const projects = [
    {
      id: 'p1',
      createdAt: new Date('2026-01-01'),
      healthOverride: null,
      healthNote: null,
      healthUpdatedAt: null,
      healthUpdatedBy: null,
    },
    {
      id: 'p2',
      createdAt: new Date('2026-01-01'),
      healthOverride: 'GREEN',
      healthNote: 'Đã thoả thuận lùi hạn với khách',
      healthUpdatedAt: new Date('2026-10-10T00:00:00Z'),
      healthUpdatedBy: { id: 'u1', displayName: 'Phúc' },
    },
    {
      id: 'p3',
      createdAt: new Date('2026-01-01'),
      healthOverride: null,
      healthNote: null,
      healthUpdatedAt: null,
      healthUpdatedBy: null,
    },
  ];
  const groupBy = vi.fn((args: GroupArgs) => {
    const by = args.by.join(',');
    const isOpen = 'status' in args.where;
    const isOverdue = 'dueDate' in args.where;
    if (by === 'projectId' && isOverdue)
      return Promise.resolve([{ projectId: 'p1', _count: { _all: 2 } }]);
    if (by === 'projectId' && isOpen)
      return Promise.resolve([
        { projectId: 'p1', _count: { _all: 6 } },
        { projectId: 'p2', _count: { _all: 3 } },
      ]);
    if (by === 'projectId')
      return Promise.resolve([
        { projectId: 'p1', _count: { _all: 10 }, _max: { resolvedAt: new Date('2026-10-14') } },
        { projectId: 'p2', _count: { _all: 5 }, _max: { resolvedAt: new Date('2026-10-14') } },
      ]);
    if (by === 'sprintId' && isOpen)
      return Promise.resolve([{ sprintId: 's1', _sum: { storyPoints: 8 } }]);
    if (by === 'sprintId') return Promise.resolve([{ sprintId: 's1', _sum: { storyPoints: 24 } }]);
    throw new Error(`groupBy bất ngờ: ${by}`);
  });
  const prisma = {
    project: { findMany: vi.fn((_a: unknown) => Promise.resolve(projects)) },
    issue: { groupBy },
    sprint: {
      findMany: vi.fn((_a: unknown) =>
        Promise.resolve([
          {
            id: 's1',
            projectId: 'p1',
            name: 'Sprint 2',
            endDate: new Date('2026-10-17'),
            sequence: 2,
          },
        ]),
      ),
    },
    raidItem: {
      findMany: vi.fn((_a: unknown) =>
        Promise.resolve([{ projectId: 'p3', title: 'Mất người', probability: 5, impact: 5 }]),
      ),
    },
  };
  return { service: new ProjectHealthService(prisma as never), prisma };
}

describe('ProjectHealthService.forProjects', () => {
  it('tự tính theo từng dự án; ghi đè thắng mức hiển thị nhưng vẫn giữ auto', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
    try {
      const { service } = make();
      const map = await service.forProjects('w1', ['p1', 'p2', 'p3']);

      // p1: 2/6 quá hạn (33%) => RED
      expect(map.get('p1')).toMatchObject({
        level: 'RED',
        auto: { level: 'RED', reasons: [expect.stringContaining('2/6')] },
        override: null,
      });
      // p2: auto GREEN, nhưng PM đặt GREEN kèm ghi chú — level = override
      expect(map.get('p2')).toMatchObject({
        level: 'GREEN',
        override: {
          level: 'GREEN',
          note: 'Đã thoả thuận lùi hạn với khách',
          updatedAt: '2026-10-10T00:00:00.000Z',
          updatedBy: { id: 'u1', displayName: 'Phúc' },
        },
      });
      // p3: chưa có việc nào nhưng có rủi ro mở mức Nghiêm trọng => RED (không được ra NONE)
      expect(map.get('p3')).toMatchObject({
        level: 'RED',
        auto: { reasons: [expect.stringContaining('Nghiêm trọng')] },
        override: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ghi đè khác tự tính: level theo ghi đè, auto giữ nguyên', async () => {
    const { service, prisma } = make();
    prisma.project.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        createdAt: new Date('2026-01-01'),
        healthOverride: 'GREEN',
        healthNote: 'ok',
        healthUpdatedAt: new Date('2026-10-10'),
        healthUpdatedBy: null,
      },
    ] as never);
    const dto = (await service.forProjects('w1', ['p1'])).get('p1')!;
    expect(dto.level).toBe('GREEN');
    expect(dto.auto.level).not.toBe('GREEN');
    expect(dto.override).toMatchObject({ level: 'GREEN', updatedBy: null });
  });

  it('chỉ một lô truy vấn gom nhóm cho cả danh sách (không N+1) và mọi truy vấn ràng projectId IN', async () => {
    const { service, prisma } = make();
    await service.forProjects('w1', ['p1', 'p2', 'p3']);
    expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.sprint.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.raidItem.findMany).toHaveBeenCalledTimes(1);
    // total + mở + quá hạn theo dự án, + 2 groupBy theo sprint
    expect(prisma.issue.groupBy).toHaveBeenCalledTimes(5);

    const projWhere = (prisma.project.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0]
      .where;
    expect(projWhere).toMatchObject({
      id: { in: ['p1', 'p2', 'p3'] },
      workspaceId: 'w1',
      deletedAt: null,
    });
    const raidWhere = (prisma.raidItem.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0]
      .where;
    expect(raidWhere).toMatchObject({
      kind: 'RISK',
      status: 'OPEN',
      projectId: { in: ['p1', 'p2', 'p3'] },
    });
    const sprintWhere = (prisma.sprint.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0]
      .where;
    expect(sprintWhere).toMatchObject({
      projectId: { in: ['p1', 'p2', 'p3'] },
      state: 'ACTIVE',
      deletedAt: null,
    });
    for (const call of prisma.issue.groupBy.mock.calls) {
      const where = call[0].where;
      expect(where.deletedAt).toBeNull();
      const scope = (where.projectId ?? where.sprintId) as { in: string[] };
      expect(scope.in.length).toBeGreaterThan(0);
    }
    const projectScoped = prisma.issue.groupBy.mock.calls.filter((c) => c[0].where.projectId);
    for (const call of projectScoped)
      expect(call[0].where.projectId).toEqual({ in: ['p1', 'p2', 'p3'] });
  });

  it('danh sách rỗng => Map rỗng, không chạm DB; id không thuộc workspace/đã xoá bị bỏ qua', async () => {
    const { service, prisma } = make();
    expect((await service.forProjects('w1', [])).size).toBe(0);
    expect(prisma.project.findMany).not.toHaveBeenCalled();

    prisma.project.findMany.mockResolvedValueOnce([] as never);
    expect((await service.forProjects('w1', ['x'])).size).toBe(0);
    expect(prisma.issue.groupBy).not.toHaveBeenCalled();
  });

  it('sprint đang chạy quá hạn mà còn điểm => RED với lý do nêu tên sprint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
    try {
      const { service } = make();
      const dto = (await service.forProjects('w1', ['p1'])).get('p1')!;
      expect(dto.auto.reasons.join(' | ')).toContain('Sprint 2 trễ 3 ngày, còn 8 điểm');
    } finally {
      vi.useRealTimers();
    }
  });
});
