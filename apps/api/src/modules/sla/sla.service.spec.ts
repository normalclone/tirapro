import { describe, expect, it, vi } from 'vitest';
import { SlaService } from './sla.service';

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

function setup(archived: boolean, policyProjectId: string | null = 'p1') {
  const prisma = {
    project: {
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: archived ? new Date() : null })),
    },
    slaPolicy: {
      findFirst: vi.fn(() => Promise.resolve({ id: 's1', projectId: policyProjectId })),
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
  };
  const access = {
    visibleWhere: vi.fn(
      (..._a: unknown[]): Promise<Record<string, unknown>> => Promise.resolve({}),
    ),
    assertCanSee: vi.fn((..._a: unknown[]) => Promise.resolve()),
  };
  return { service: new SlaService(prisma as never, access as never), prisma, access };
}

describe('SlaService — dự án lưu trữ là chỉ đọc', () => {
  it('create/update/remove chính sách của dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.create(
        'w1',
        {
          name: 'S',
          projectId: 'p1',
          responseMins: 5,
          resolveMins: 60,
        },
        'u1',
      ),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.update('w1', 's1', { name: 'Mới' }, 'u1')).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 's1', 'u1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.slaPolicy.create).not.toHaveBeenCalled();
    expect(prisma.slaPolicy.update).not.toHaveBeenCalled();
    expect(prisma.slaPolicy.deleteMany).not.toHaveBeenCalled();
  });

  it('update chuyển chính sách sang dự án đã lưu trữ => 422', async () => {
    const live = setup(false);
    live.prisma.project.findUnique.mockImplementation(((a: { where: { id: string } }) =>
      Promise.resolve({
        archivedAt: a.where.id === 'pArchived' ? new Date() : null,
      })) as never);
    await expect(
      live.service.update('w1', 's1', { projectId: 'pArchived' }, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    expect(live.prisma.slaPolicy.update).not.toHaveBeenCalled();
  });

  it('dự án đang hoạt động vẫn tạo/sửa/xoá được', async () => {
    const live = setup(false);
    await live.service.create(
      'w1',
      { name: 'S', projectId: 'p1', responseMins: 5, resolveMins: 60 },
      'u1',
    );
    await live.service.update('w1', 's1', { name: 'Mới' }, 'u1');
    await live.service.remove('w1', 's1', 'u1');
    expect(live.prisma.slaPolicy.create).toHaveBeenCalled();
    expect(live.prisma.slaPolicy.update).toHaveBeenCalled();
    expect(live.prisma.slaPolicy.deleteMany).toHaveBeenCalled();
  });
});

describe('SlaService — chính sách chỉ cấp dự án', () => {
  it('create thiếu projectId (hoặc rỗng/null) => 422 PROJECT_REQUIRED, không ghi', async () => {
    const { service, prisma } = setup(false);
    for (const projectId of [undefined, null, '']) {
      await expect(
        service.create('w1', { name: 'S', projectId, responseMins: 5, resolveMins: 60 }, 'u1'),
      ).rejects.toMatchObject({ status: 422, code: 'PROJECT_REQUIRED' });
    }
    expect(prisma.slaPolicy.create).not.toHaveBeenCalled();
  });

  it('update xoá trống dự án (projectId: null) => 422 PROJECT_REQUIRED, không ghi; đổi sang dự án khác thì lưu', async () => {
    const { service, prisma } = setup(false);
    await expect(service.update('w1', 's1', { projectId: null }, 'u1')).rejects.toMatchObject({
      status: 422,
      code: 'PROJECT_REQUIRED',
    });
    expect(prisma.slaPolicy.update).not.toHaveBeenCalled();
    await service.update('w1', 's1', { projectId: 'p2' }, 'u1');
    expect((prisma.slaPolicy.update.mock.calls as unknown[][])[0]![0]).toMatchObject({
      data: { projectId: 'p2' },
    });
  });

  it('list: chỉ chính sách của dự án còn sống người xem thấy; ?projectId thu hẹp theo một dự án', async () => {
    const { service, prisma } = setup(false);
    await service.list('w1', 'u1');
    await service.list('w1', 'u1', 'p9');
    const wheres = (prisma.slaPolicy.findMany.mock.calls as unknown as [{ where: object }][]).map(
      (c) => c[0].where,
    );
    expect(wheres[0]).toEqual({ workspaceId: 'w1', project: { deletedAt: null } });
    expect(wheres[1]).toMatchObject({ workspaceId: 'w1', projectId: 'p9' });
    expect(wheres[0]).not.toHaveProperty('OR');
  });
});

describe('SlaService — dự án riêng tư: bảng SLA và chính sách không lộ dự án ẩn (P15)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

  function withBoard() {
    const base = setup(false);
    (base.prisma as Record<string, unknown>).issueSla = {
      findMany: vi.fn(() => Promise.resolve([])),
    };
    return base as typeof base & { prisma: { issueSla: { findMany: ReturnType<typeof vi.fn> } } };
  }

  it('board: where.issue.project = visible (người ngoài không thấy khoá/tiêu đề/người phụ trách)', async () => {
    const { service, prisma, access } = withBoard();
    access.visibleWhere.mockResolvedValue(visible);
    await service.board('w1', 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    const where = (prisma.issueSla.findMany.mock.calls[0] as unknown as [{ where: object }])[0]
      .where;
    expect(where).toMatchObject({
      issue: { workspaceId: 'w1', deletedAt: null, project: { deletedAt: null, ...visible } },
      resolvedAt: null,
    });
  });

  it('board: ?projectId thu hẹp theo một dự án (bảng "Thời gian xử lý" của dự án), vẫn theo quyền xem', async () => {
    const { service, prisma, access } = withBoard();
    access.visibleWhere.mockResolvedValue(visible);
    await service.board('w1', 'u1', 'p9');
    const where = (
      prisma.issueSla.findMany.mock.calls[0] as unknown as [{ where: { issue: object } }]
    )[0].where.issue;
    expect(where).toMatchObject({
      workspaceId: 'w1',
      projectId: 'p9',
      project: { deletedAt: null, ...visible },
    });
  });

  it('board: chọn priority kèm rank (FE suy mũi tên ưu tiên theo hạng, không chỉ màu)', async () => {
    const { service, prisma } = withBoard();
    await service.board('w1', 'u1');
    const arg = prisma.issueSla.findMany.mock.calls[0] as unknown as [
      { include: { issue: { select: { priority: { select: Record<string, boolean> } } } } },
    ];
    expect(arg[0].include.issue.select.priority.select).toMatchObject({
      name: true,
      color: true,
      rank: true,
    });
  });

  it('board: người thấy hết (admin/thành viên) → không thêm điều kiện project', async () => {
    const { service, prisma } = withBoard();
    await service.board('w1', 'u1');
    const where = (
      prisma.issueSla.findMany.mock.calls[0] as unknown as [{ where: { issue: object } }]
    )[0].where;
    expect(where.issue).not.toHaveProperty('project');
  });

  it('list chính sách: chỉ dự án thấy được (không còn chính sách chung)', async () => {
    const { service, prisma, access } = setup(false);
    access.visibleWhere.mockResolvedValue(visible);
    await service.list('w1', 'u1');
    expect((prisma.slaPolicy.findMany.mock.calls as unknown[][])[0]![0]).toMatchObject({
      where: { workspaceId: 'w1', project: { deletedAt: null, ...visible } },
    });
  });

  it('update/remove chính sách của dự án ẩn → 404 (assertCanSee ném), không ghi', async () => {
    const { service, prisma, access } = setup(false, 'pHidden');
    access.assertCanSee.mockRejectedValue(Object.assign(new Error('Cam kết'), { status: 404 }));
    await expect(service.update('w1', 's1', { name: 'x' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.remove('w1', 's1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(access.assertCanSee).toHaveBeenCalledWith(
      'u1',
      'w1',
      'pHidden',
      'Cam kết thời gian xử lý',
    );
    expect(prisma.slaPolicy.update).not.toHaveBeenCalled();
    expect(prisma.slaPolicy.deleteMany).not.toHaveBeenCalled();
  });

  it('không gắn chính sách sang dự án ẩn (create/update body.projectId)', async () => {
    const { service, prisma, access } = setup(false, null);
    access.assertCanSee.mockRejectedValue(Object.assign(new Error('Dự án'), { status: 404 }));
    await expect(
      service.create(
        'w1',
        { name: 'S', projectId: 'pHidden', responseMins: 5, resolveMins: 60 },
        'u1',
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.update('w1', 's1', { projectId: 'pHidden' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.slaPolicy.create).not.toHaveBeenCalled();
    expect(prisma.slaPolicy.update).not.toHaveBeenCalled();
  });
});

describe('SlaService — thời gian xử lý hiển thị đúng thực tế (logbug #26)', () => {
  type Mocked = { mock: { calls: unknown[][] } };
  const dataOf = (fn: Mocked) =>
    (fn.mock.calls[0]![0] as { data: { resolveDueAt: Date; policyId?: string } }).data;
  const whereOf = (fn: Mocked) =>
    (fn.mock.calls[0]![0] as { where: { issue?: { status?: unknown } } }).where;
  const hour = 3_600_000;
  function make(over: { issue?: Record<string, unknown>; sla?: Record<string, unknown> } = {}) {
    const created = new Date(Date.now() - 10 * hour);
    const sla = {
      issueId: 'i1',
      policyId: 'pol1',
      responseDueAt: new Date(created.getTime() + hour),
      resolveDueAt: new Date(created.getTime() + 24 * hour),
      firstRespondedAt: null,
      resolvedAt: null,
      responseBreached: false,
      resolveBreached: false,
      policy: { name: 'P', responseMins: 60, resolveMins: 1440 },
      ...over.sla,
    };
    const prisma = {
      issue: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: 'i1',
            resolvedAt: null,
            updatedAt: new Date(),
            status: { category: 'IN_PROGRESS' },
            ...over.issue,
          }),
        ),
      },
      issueSla: {
        findUnique: vi.fn(() => Promise.resolve(sla)),
        findMany: vi.fn(() => Promise.resolve([])),
        create: vi.fn((_a: unknown) => Promise.resolve({})),
        update: vi.fn((_a: unknown) => Promise.resolve({})),
      },
      slaPolicy: {
        findMany: vi.fn(() =>
          Promise.resolve([
            {
              id: 'polNew',
              projectId: 'p',
              priorityId: 'high',
              responseMins: 30,
              resolveMins: 120,
            },
          ]),
        ),
      },
    };
    return { service: new SlaService(prisma as never, {} as never), prisma, created };
  }

  it('việc đã ở trạng thái DONE mà dòng SLA chưa đóng → coi là đã xong, không còn "còn N giờ"', async () => {
    const { service } = make({ issue: { status: { category: 'DONE' }, resolvedAt: new Date() } });
    const r = await service.getForIssue('w', 'i1');
    expect(r?.resolvedAt).not.toBeNull();
    expect(r?.resolveRemainingMins).toBeNull();
    expect(r?.resolveBreached).toBe(false);
  });

  it('board loại việc đã ở nhóm DONE', async () => {
    const { service, prisma } = make();
    const access = { visibleWhere: () => Promise.resolve({}) };
    const svc = new SlaService(prisma as never, access as never);
    await svc.board('w', 'u');
    const where = whereOf(prisma.issueSla.findMany);
    expect(where.issue?.status).toEqual({ category: { not: 'DONE' } });
    void service;
  });

  it('hạn tính từ lúc TẠO việc (createdAt), không phải lúc xử lý sự kiện', async () => {
    const { service, prisma, created } = make();
    await service.onIssueCreated({
      issue: {
        id: 'i1',
        workspaceId: 'w',
        projectId: 'p',
        priority: { id: 'high' },
        createdAt: created,
      },
    });
    const data = dataOf(prisma.issueSla.create);
    expect(data.resolveDueAt.getTime()).toBe(created.getTime() + 120 * 60000);
  });

  it('mở lại việc: bỏ cả cờ trễ cũ', async () => {
    const { service, prisma } = make({ sla: { resolvedAt: new Date(), resolveBreached: true } });
    await service.onIssueTransitioned({ issue: { id: 'i1', status: { category: 'IN_PROGRESS' } } });
    expect(dataOf(prisma.issueSla.update)).toEqual({
      resolvedAt: null,
      resolveBreached: false,
    });
  });

  it('chọn chính sách CHỈ trong dự án của việc (không còn mặc định cấp tổ chức)', async () => {
    const { service, prisma } = make();
    await service.onIssueCreated({
      issue: { id: 'i9', workspaceId: 'w', projectId: 'p', priority: { id: 'high' } },
    });
    expect((prisma.slaPolicy.findMany.mock.calls as unknown[][])[0]![0]).toEqual({
      where: { workspaceId: 'w', projectId: 'p', active: true },
    });
  });

  it('đổi mức ưu tiên → áp lại cam kết khớp, tính lại hạn từ lúc tạo', async () => {
    const { service, prisma, created } = make();
    await service.onIssueUpdated({
      issue: {
        id: 'i1',
        workspaceId: 'w',
        projectId: 'p',
        priority: { id: 'high' },
        createdAt: created,
      },
      changedFields: ['priorityId'],
    });
    const data = dataOf(prisma.issueSla.update);
    expect(data.policyId).toBe('polNew');
    expect(data.resolveDueAt.getTime()).toBe(created.getTime() + 120 * 60000);
  });
});
