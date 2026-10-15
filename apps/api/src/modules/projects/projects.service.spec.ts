import { describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  workspaceId: 'w1',
  key: 'DEMO',
  name: 'Demo',
  description: null,
  type: 'SCRUM',
  leadId: null,
  avatarUrl: null,
  defaultAssigneeMode: 'UNASSIGNED',
  isArchived: false,
  archivedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  _count: { issues: 0 },
  lead: null,
  ...over,
});

function make(
  over: {
    dupName?: boolean;
    member?: boolean;
    archivedCount?: number;
    cur?: Record<string, unknown> | null;
  } = {},
) {
  const prisma = {
    project: {
      findFirst: vi.fn((args: { where: { name?: string; id?: unknown } }) => {
        if (args.where.name !== undefined)
          return Promise.resolve(over.dupName ? { id: 'other' } : null);
        return Promise.resolve(over.cur === null ? null : (over.cur ?? row()));
      }),
      findMany: vi.fn((_args: { where: Record<string, unknown> }) => Promise.resolve([row()])),
      update: vi.fn(() => Promise.resolve({ id: 'p1' })),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: over.archivedCount ?? 1 }),
      ),
    },
    workspaceMembership: {
      findUnique: vi.fn(() => Promise.resolve(over.member === false ? null : { id: 'm1' })),
    },
  };
  return { service: new ProjectsService(prisma as never, {} as never), prisma };
}

describe('ProjectsService — lưu trữ / sửa / xoá', () => {
  it('list(): mặc định ẩn dự án đã lưu trữ, includeArchived=true thì hiện', async () => {
    const { service, prisma } = make();
    await service.list('w1');
    expect(prisma.project.findMany.mock.calls[0]![0].where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      archivedAt: null,
    });
    await service.list('w1', true);
    expect(prisma.project.findMany.mock.calls[1]![0].where).not.toHaveProperty('archivedAt');
  });

  it('archive(): ghi archivedAt + isArchived có điều kiện chưa lưu trữ; đã lưu trữ rồi => lỗi', async () => {
    const { service, prisma } = make();
    await service.archive('w1', 'p1', 'u1');
    const call = prisma.project.updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: 'p1', archivedAt: null });
    expect(call.data).toMatchObject({ isArchived: true, updatedById: 'u1' });
    expect(call.data.archivedAt).toBeInstanceOf(Date);

    const again = make({ archivedCount: 0 });
    await expect(again.service.archive('w1', 'p1', 'u1')).rejects.toMatchObject({ status: 422 });
  });

  it('unarchive(): xoá archivedAt + isArchived', async () => {
    const { service, prisma } = make();
    await service.unarchive('w1', 'p1', 'u1');
    expect(prisma.project.updateMany.mock.calls[0]![0].data).toMatchObject({
      archivedAt: null,
      isArchived: false,
    });
  });

  it('dự án không tồn tại => 404', async () => {
    const { service } = make({ cur: null });
    await expect(service.archive('w1', 'zzz', 'u1')).rejects.toMatchObject({ status: 404 });
    await expect(service.remove('w1', 'zzz', 'u1')).rejects.toMatchObject({ status: 404 });
  });

  it('remove(): xoá mềm (deletedAt)', async () => {
    const { service, prisma } = make();
    await expect(service.remove('w1', 'p1', 'u1')).resolves.toEqual({ success: true });
    expect(prisma.project.updateMany.mock.calls[0]![0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('update(): tên trùng dự án khác => lỗi; người phụ trách không phải thành viên => lỗi', async () => {
    await expect(
      make({ dupName: true }).service.update('w1', 'p1', 'u1', { name: 'Trùng' }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      make({ member: false }).service.update('w1', 'p1', 'u1', { leadId: 'ngoài' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('update(): chỉ ghi các trường được gửi', async () => {
    const { service, prisma } = make();
    await service.update('w1', 'p1', 'u1', {
      description: 'Mô tả mới',
      defaultAssigneeMode: 'PROJECT_LEAD',
    });
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: { updatedById: 'u1', description: 'Mô tả mới', defaultAssigneeMode: 'PROJECT_LEAD' },
      }),
    );
  });
});

describe('ProjectsService — dự án lưu trữ là chỉ đọc (cài đặt chung)', () => {
  const archivedRow = () => row({ archivedAt: new Date('2026-10-10T00:00:00Z'), isArchived: true });

  it('update() trên dự án đã lưu trữ => 422 PROJECT_ARCHIVED_MESSAGE, không ghi', async () => {
    const { service, prisma } = make({ cur: archivedRow() });
    await expect(
      service.update('w1', 'p1', 'u1', { description: 'Mô tả mới' }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('lưu trữ') as unknown,
    });
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('unarchive()/remove() KHÔNG bị chặn (vòng đời dự án)', async () => {
    const { service, prisma } = make({ cur: archivedRow() });
    await service.unarchive('w1', 'p1', 'u1');
    await service.remove('w1', 'p1', 'u1');
    expect(prisma.project.updateMany).toHaveBeenCalledTimes(2);
  });

  it('setAvatar()/clearAvatar() trên dự án đã lưu trữ => 422, không lưu tệp, không ghi', async () => {
    const media = { saveAvatar: vi.fn(() => Promise.resolve('/u/a.png')), removeByUrl: vi.fn() };
    const prisma = {
      project: {
        findFirst: vi.fn(() =>
          Promise.resolve({ id: 'p1', avatarUrl: null, archivedAt: new Date() }),
        ),
        update: vi.fn(() => Promise.resolve({})),
      },
    };
    const service = new ProjectsService(prisma as never, media as never);
    await expect(service.setAvatar('w1', 'DEMO', undefined, {} as never)).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.clearAvatar('w1', 'DEMO')).rejects.toMatchObject({ status: 422 });
    expect(media.saveAvatar).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.create — vai trò chủ dự án', () => {
  it('membership của người tạo có dòng nối ProjectMembershipRole (Quản trị dự án)', async () => {
    const ok = () => vi.fn(() => Promise.resolve({ id: 'x' }));
    const tx = {
      project: {
        create: vi.fn(() => Promise.resolve(row({ id: 'p1', name: 'D' }))),
        update: ok(),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
    };
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const svc = new ProjectsService(prisma as never, {} as never);
    await svc.create('w1', 'u1', { key: 'D', name: 'D', type: 'SCRUM' } as never);
    const arg = tx.projectMembership.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(arg[0].data).toMatchObject({
      projectId: 'p1',
      userId: 'u1',
      roleId: 'r-padmin',
      roles: { create: [{ roleId: 'r-padmin' }] },
    });
  });
});
