import { describe, expect, it, vi } from 'vitest';
import { GoalsService } from './goals.service';

type IssueWhere = { where: Record<string, unknown> };
const LIVE = { deletedAt: null };

describe('GoalsService — không đếm/gắn issue của dự án xoá mềm', () => {
  it('validateIssues: where có project.deletedAt:null (không gắn được issue của dự án đã xoá)', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'i1' }]));
    const service = new GoalsService({ issue: { findMany } } as never);
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
    const service = new GoalsService({ objective: { findMany } } as never);
    await service.list('w1', {});
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
  return { service: new GoalsService(prisma as never), prisma };
}

describe('GoalsService — dự án lưu trữ là chỉ đọc', () => {
  it('create gắn vào dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.create('w1', { name: 'O', period: '2026-Q4', projectId: 'p1' }),
    ).rejects.toMatchObject(ARCHIVED);
    expect(prisma.objective.create).not.toHaveBeenCalled();
  });

  it('update chuyển mục tiêu sang dự án đã lưu trữ => 422', async () => {
    const { service, prisma } = setup(true, false);
    await expect(service.update('w1', 'o1', { projectId: 'p1' })).rejects.toMatchObject(ARCHIVED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('update/remove/KR/issue của mục tiêu thuộc dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(service.update('w1', 'o1', { name: 'Mới' })).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 'o1')).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.addKeyResult('w1', 'o1', { name: 'KR', targetValue: 10 }),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5 }),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeKeyResult('w1', 'o1', 'k1')).rejects.toMatchObject(ARCHIVED);
    await expect(service.addIssues('w1', 'o1', ['i1'])).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeIssues('w1', 'o1', ['i1'])).rejects.toMatchObject(ARCHIVED);
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
    await service.remove('w1', 'o1');
    expect(prisma.objective.delete).toHaveBeenCalled();
  });
});
