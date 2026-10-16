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

  it('update chuyển chính sách chung sang dự án đã lưu trữ => 422', async () => {
    const { service, prisma } = setup(true, null);
    await expect(service.update('w1', 's1', { projectId: 'p1' }, 'u1')).rejects.toMatchObject(
      ARCHIVED,
    );
    expect(prisma.slaPolicy.update).not.toHaveBeenCalled();
  });

  it('chính sách chung (không gắn dự án) và dự án đang hoạt động vẫn ghi được', async () => {
    const shared = setup(true, null);
    await shared.service.create('w1', { name: 'S', responseMins: 5, resolveMins: 60 }, 'u1');
    await shared.service.remove('w1', 's1', 'u1');
    expect(shared.prisma.slaPolicy.create).toHaveBeenCalled();
    expect(shared.prisma.slaPolicy.deleteMany).toHaveBeenCalled();

    const live = setup(false);
    await live.service.update('w1', 's1', { name: 'Mới' }, 'u1');
    expect(live.prisma.slaPolicy.update).toHaveBeenCalled();
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

  it('board: người thấy hết (admin/thành viên) → không thêm điều kiện project', async () => {
    const { service, prisma } = withBoard();
    await service.board('w1', 'u1');
    const where = (
      prisma.issueSla.findMany.mock.calls[0] as unknown as [{ where: { issue: object } }]
    )[0].where;
    expect(where.issue).not.toHaveProperty('project');
  });

  it('list chính sách: OR [chung, dự án thấy được]', async () => {
    const { service, prisma, access } = setup(false);
    access.visibleWhere.mockResolvedValue(visible);
    await service.list('w1', 'u1');
    expect((prisma.slaPolicy.findMany.mock.calls as unknown[][])[0]![0]).toMatchObject({
      where: {
        workspaceId: 'w1',
        OR: [{ projectId: null }, { project: { deletedAt: null, ...visible } }],
      },
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
