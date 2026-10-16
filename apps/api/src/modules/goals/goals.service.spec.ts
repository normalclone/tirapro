import { describe, expect, it, vi } from 'vitest';
import { GoalsService } from './goals.service';

/** ProjectAccessService giả: người xem thấy mọi dự án (admin) / không có viewer. */
const ACCESS_ALL = { visibleWhere: vi.fn(() => Promise.resolve({})) };

type IssueWhere = { where: Record<string, unknown> };
const LIVE = { deletedAt: null };

describe('GoalsService — không đếm/gắn issue của dự án xoá mềm', () => {
  it('validateIssues: where có project.deletedAt:null (không gắn được issue của dự án đã xoá)', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'i1' }]));
    const service = new GoalsService({ issue: { findMany } } as never, ACCESS_ALL as never);
    const validate = (
      service as unknown as {
        validateIssues(w: string, ids: string[], p: string | null): Promise<string[]>;
      }
    ).validateIssues.bind(service);
    await expect(validate('w1', ['i1'], null)).resolves.toEqual(['i1']);
    const { where } = (findMany.mock.calls[0] as unknown as [IssueWhere])[0];
    expect(where).toMatchObject({ workspaceId: 'w1', deletedAt: null, project: LIVE });
    // Có projectId của mục tiêu: điều kiện dự án sống vẫn còn, projectId được thêm vào.
    await validate('w1', ['i1'], 'p1');
    const w2 = (findMany.mock.calls[1] as unknown as [IssueWhere])[0].where;
    expect(w2).toMatchObject({ projectId: 'p1', project: LIVE });
  });

  it('list: issue gắn kèm lọc cả issue xoá mềm lẫn dự án xoá mềm', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new GoalsService({ objective: { findMany } } as never, ACCESS_ALL as never);
    await service.list('w1', {}, 'u0');
    const { select } = (
      findMany.mock.calls[0] as unknown as [{ select: { issues: { where: unknown } } }]
    )[0];
    expect(select.issues.where).toEqual({ issue: { deletedAt: null, project: LIVE } });
  });
});

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

/** Dự án `archived` quyết định: mục tiêu gắn dự án đó là chỉ đọc; mục tiêu cả workspace (project null) thì không. */
function setup(archived: boolean, objectiveProject = true) {
  const archivedAt = archived ? new Date() : null;
  const prisma = {
    objective: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'o1',
          projectId: objectiveProject ? 'p1' : null,
          project: objectiveProject ? { archivedAt } : null,
        }),
      ),
      create: vi.fn(() => Promise.resolve({ id: 'o2' })),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1', archivedAt })) },
    keyResult: {
      create: vi.fn(() => Promise.resolve({})),
      findFirst: vi.fn(() => Promise.resolve({ id: 'k1' })),
      update: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    objectiveIssue: {
      createMany: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({})),
    },
    issue: { findMany: vi.fn(() => Promise.resolve([{ id: 'i1' }])) },
    workspaceMembership: { findFirst: vi.fn(() => Promise.resolve({ userId: 'u1' })) },
    $transaction: vi.fn(() => Promise.resolve([])),
  };
  return { service: new GoalsService(prisma as never, ACCESS_ALL as never), prisma };
}

describe('GoalsService — dự án lưu trữ là chỉ đọc', () => {
  it('create gắn vào dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.create('w1', { name: 'O', period: '2026-Q4', projectId: 'p1' }, 'u0'),
    ).rejects.toMatchObject(ARCHIVED);
    expect(prisma.objective.create).not.toHaveBeenCalled();
  });

  it('update chuyển mục tiêu sang dự án đã lưu trữ => 422', async () => {
    const { service, prisma } = setup(true, false);
    await expect(service.update('w1', 'o1', { projectId: 'p1' }, 'u0')).rejects.toMatchObject(
      ARCHIVED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('update/remove/KR/issue của mục tiêu thuộc dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(service.update('w1', 'o1', { name: 'Mới' }, 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 'o1', 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.addKeyResult('w1', 'o1', { name: 'KR', targetValue: 10 }, 'u0'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5 }, 'u0'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeKeyResult('w1', 'o1', 'k1', 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(service.addIssues('w1', 'o1', ['i1'], 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeIssues('w1', 'o1', ['i1'], 'u0')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.objective.delete).not.toHaveBeenCalled();
    expect(prisma.keyResult.create).not.toHaveBeenCalled();
    expect(prisma.keyResult.update).not.toHaveBeenCalled();
    expect(prisma.keyResult.deleteMany).not.toHaveBeenCalled();
    expect(prisma.objectiveIssue.createMany).not.toHaveBeenCalled();
    expect(prisma.objectiveIssue.deleteMany).not.toHaveBeenCalled();
  });

  it('mục tiêu cả workspace (không gắn dự án) vẫn xoá được', async () => {
    const { service, prisma } = setup(true, false);
    await service.remove('w1', 'o1', 'u0');
    expect(prisma.objective.delete).toHaveBeenCalled();
  });
});

describe('GoalsService — dự án riêng tư (P14)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const scope = { OR: [{ projectId: null }, { project: visible }] };
  const whereOf = (fn: ReturnType<typeof vi.fn>, i = 0) =>
    (fn.mock.calls[i] as unknown as [{ where: unknown }])[0].where;

  function make() {
    const prisma = {
      objective: {
        findMany: vi.fn((_a?: unknown) => Promise.resolve([])),
        findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)),
        create: vi.fn(() => Promise.resolve({ id: 'o2' })),
      },
      project: { findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)) },
      issue: { findMany: vi.fn((_a?: unknown) => Promise.resolve([])) },
    };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visible)) };
    return { service: new GoalsService(prisma as never, access as never), prisma, access };
  }

  it('list(w, f, viewer): mục tiêu cấp workspace luôn hiện, gắn dự án chỉ khi thấy; việc gắn kèm của dự án ẩn bị bỏ', async () => {
    const { service, prisma, access } = make();
    await service.list('w1', { period: '2026-Q4' }, 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(whereOf(prisma.objective.findMany)).toMatchObject({
      workspaceId: 'w1',
      period: '2026-Q4',
      ...scope,
    });
    const { select } = (
      prisma.objective.findMany.mock.calls[0] as unknown as [
        { select: { issues: { where: unknown } } },
      ]
    )[0];
    expect(select.issues.where).toEqual({
      issue: { deletedAt: null, project: { deletedAt: null, ...visible } },
    });
  });

  it('periods(w, viewer): chỉ kỳ của mục tiêu người xem thấy', async () => {
    const { service, prisma } = make();
    await service.periods('w1', 'u1');
    expect(whereOf(prisma.objective.findMany)).toMatchObject({ workspaceId: 'w1', ...scope });
  });

  it('get(w, id, viewer): mục tiêu của dự án riêng tư không thấy → 404 "Mục tiêu" như không tồn tại', async () => {
    const { service, prisma } = make();
    await expect(service.get('w1', 'o1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(whereOf(prisma.objective.findFirst)).toMatchObject({ id: 'o1', ...scope });
  });

  it('thao tác ghi (update/remove/KR/issue) cũng 404 khi mục tiêu thuộc dự án ẩn', async () => {
    const { service, prisma } = make();
    await expect(service.update('w1', 'o1', { name: 'x' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.remove('w1', 'o1', 'u1')).rejects.toMatchObject({ status: 404 });
    await expect(
      service.addKeyResult('w1', 'o1', { name: 'KR', targetValue: 1 }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.addIssues('w1', 'o1', ['i1'], 'u1')).rejects.toMatchObject({
      status: 404,
    });
    for (let i = 0; i < 4; i++)
      expect(whereOf(prisma.objective.findFirst, i)).toMatchObject({ id: 'o1', ...scope });
  });

  it('create gắn vào dự án riêng tư không thấy → 404 "Dự án"; không tạo', async () => {
    const { service, prisma } = make();
    await expect(
      service.create('w1', { name: 'O', period: '2026-Q4', projectId: 'hr' }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(whereOf(prisma.project.findFirst)).toMatchObject({ id: 'hr', ...visible });
    expect(prisma.objective.create).not.toHaveBeenCalled();
  });

  it('gắn việc: chỉ nhận việc của dự án người xem thấy (việc ở dự án ẩn bị từ chối như việc không tồn tại)', async () => {
    const { service, prisma } = make();
    prisma.objective.findFirst.mockResolvedValue({
      id: 'o1',
      projectId: null,
      project: null,
    } as never);
    await expect(service.addIssues('w1', 'o1', ['i-hidden'], 'u1')).rejects.toMatchObject({
      status: 403,
    });
    expect(whereOf(prisma.issue.findMany)).toMatchObject({
      id: { in: ['i-hidden'] },
      project: { deletedAt: null, ...visible },
    });
  });

  it('update(issueIds): chỉ thay phần việc thuộc dự án người sửa thấy, KHÔNG xoá liên kết tới việc của dự án ẩn (I1)', async () => {
    const { service, prisma } = make();
    prisma.objective.findFirst.mockResolvedValue({
      id: 'o1',
      projectId: null,
      project: null,
    } as never);
    prisma.issue.findMany.mockResolvedValue([{ id: 'i1' }] as never);
    const deleteMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 0 }));
    const createMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 1 }));
    Object.assign(prisma, {
      objectiveIssue: { deleteMany, createMany },
      keyResult: { findMany: vi.fn(() => Promise.resolve([])) },
      $transaction: vi.fn(() => Promise.resolve([])),
    });
    (prisma.objective as Record<string, unknown>).update = vi.fn(() => Promise.resolve({}));
    await expect(service.update('w1', 'o1', { issueIds: ['i1'] }, 'u1')).rejects.toBeDefined(); // get() sau ghi: mock trả null → 404
    expect(whereOf(deleteMany)).toEqual({ objectiveId: 'o1', issue: { project: visible } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ objectiveId: 'o1', issueId: 'i1' }] });
  });

  it('removeIssues: chỉ gỡ việc thuộc dự án người gọi thấy (không dò/gỡ liên kết tới việc dự án ẩn)', async () => {
    const { service, prisma } = make();
    prisma.objective.findFirst.mockResolvedValue({
      id: 'o1',
      projectId: null,
      project: null,
    } as never);
    const deleteMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 0 }));
    Object.assign(prisma, { objectiveIssue: { deleteMany } });
    await expect(service.removeIssues('w1', 'o1', ['i-hidden'], 'u1')).rejects.toBeDefined(); // read() sau ghi: mock trả null → 404
    expect(whereOf(deleteMany)).toEqual({
      objectiveId: 'o1',
      issueId: { in: ['i-hidden'] },
      issue: { project: visible },
    });
  });
});
