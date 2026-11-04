import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { SavedFiltersService } from './saved-filters.service';

const VISIBLE = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
const P = { id: 'p1', key: 'HR', name: 'HR' };
const person = (id: string) => ({ id, displayName: id, avatarUrl: null });

const row = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  name: 'n',
  jql: 'project = HR',
  visibility: 'PRIVATE',
  ownerId: 'u1',
  createdAt: new Date('2026-10-16T00:00:00Z'),
  owner: person('u1'),
  projectShares: [] as { project: typeof P }[],
  userShares: [] as { user: ReturnType<typeof person> }[],
  ...over,
});

function make(visibleIds: string[] | null = ['p1']) {
  const base = row();
  const prisma = {
    savedFilter: {
      findMany: vi.fn(() => Promise.resolve([base])),
      findFirst: vi.fn((_a: unknown) => Promise.resolve(base as typeof base | null)),
      update: vi.fn(() => Promise.resolve(base)),
    },
    project: {
      findMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(a.where.id.in.map((id) => ({ id }))),
      ),
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })),
    },
    workspaceMembership: {
      findMany: vi.fn((a: { where: { userId: { in: string[] } } }) =>
        Promise.resolve(a.where.userId.in.map((userId) => ({ userId }))),
      ),
    },
    user: { findMany: vi.fn(() => Promise.resolve([{ displayName: 'Ai đó' }])) },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  // Giao dịch đọc cùng nguồn giả với `prisma` (đọc hiện trạng + kiểm đích nằm TRONG giao dịch), thêm khoá hàng + các lệnh ghi.
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([{ id: 'f1' }])),
    savedFilter: {
      findFirst: prisma.savedFilter.findFirst,
      create: vi.fn(() => Promise.resolve({ id: 'f1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    project: prisma.project,
    workspaceMembership: prisma.workspaceMembership,
    user: prisma.user,
    savedFilterProjectShare: { deleteMany: vi.fn(), createMany: vi.fn() },
    savedFilterUserShare: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const search = { search: vi.fn(() => Promise.resolve({ data: [], meta: {} })) };
  const access = {
    visibleWhere: vi.fn(() => Promise.resolve(visibleIds === null ? {} : VISIBLE)),
    visibleProjectIds: vi.fn(() => Promise.resolve(visibleIds)),
  };
  const notifications = { publish: vi.fn(() => Promise.resolve()) };
  const service = new SavedFiltersService(
    prisma as never,
    search as never,
    access as never,
    notifications as never,
  );
  return { service, prisma, tx, search, access, notifications };
}

const whereOf = (m: { mock: { calls: unknown[][] } }) =>
  JSON.stringify((m.mock.calls[0] as unknown as [{ where: unknown }])[0].where);

describe('SavedFiltersService — phạm vi xem', () => {
  it('list(): của mình / chia sẻ trực tiếp cho mình / thành viên dự án được chia sẻ (dự án sống, xem được)', async () => {
    const { service, prisma } = make();
    await service.list('w1', 'u1');
    const where = whereOf(prisma.savedFilter.findMany);
    expect(where).toContain('"ownerId":"u1"');
    expect(where).toContain('"userShares":{"some":{"userId":"u1"}}');
    expect(where).toContain('"projectShares":{"some":{"project":');
    expect(where).toContain('"deletedAt":null');
    expect(where).toContain(JSON.stringify(VISIBLE));
    // Chỉ MỘT điều kiện thành viên — nằm trong visibleWhere; không còn luật "chỉ thành viên" riêng cho bộ lọc
    expect(where.split('"memberships"').length - 1).toBe(1);
    expect(where).not.toContain('WORKSPACE');
  });

  it('run(): chạy JQL với người xem; bộ lọc không thấy → 404 "Bộ lọc", không chạy', async () => {
    const { service, search, prisma } = make();
    await service.run('w1', 'u1', 'f1', { limit: 50 });
    expect(search.search).toHaveBeenCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ jql: 'project = HR' }),
    );
    prisma.savedFilter.findFirst.mockResolvedValue(null);
    search.search.mockClear();
    await expect(service.run('w1', 'u2', 'f1', { limit: 50 })).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    expect(search.search).not.toHaveBeenCalled();
  });

  it('list(): chủ thấy đủ chia sẻ; người khác chỉ thấy dự án họ xem được + chính mình, access = shared', async () => {
    const shared = row({
      visibility: 'SHARED',
      ownerId: 'u2',
      owner: person('u2'),
      projectShares: [{ project: P }, { project: { id: 'p9', key: 'SEC', name: 'Secret' } }],
      userShares: [{ user: person('u1') }, { user: person('u3') }],
    });
    const asViewer = make(['p1']);
    asViewer.prisma.savedFilter.findMany.mockResolvedValue([shared]);
    const [v] = await asViewer.service.list('w1', 'u1');
    expect(v).toMatchObject({ access: 'shared', isOwner: false, owner: person('u2') });
    expect(v!.sharedProjects.map((p) => p.id)).toEqual(['p1']);
    expect(v!.sharedUsers.map((u) => u.id)).toEqual(['u1']);

    const asOwner = make(['p1']);
    asOwner.prisma.savedFilter.findMany.mockResolvedValue([shared]);
    const [o] = await asOwner.service.list('w1', 'u2');
    expect(o).toMatchObject({ access: 'owner', isOwner: true });
    expect(o!.sharedProjects.map((p) => p.id)).toEqual(['p1', 'p9']);
    expect(o!.sharedUsers.map((u) => u.id)).toEqual(['u1', 'u3']);
  });
});

describe('SavedFiltersService — chia sẻ', () => {
  it('create(): đích sai → 422 mã riêng, không ghi gì', async () => {
    const { service, prisma, tx } = make();
    prisma.project.findMany.mockResolvedValue([]);
    await expect(
      service.create('w1', 'u1', {
        name: 'x',
        jql: 'project = HR',
        visibility: 'SHARED',
        sharedProjectIds: ['hr'],
      }),
    ).rejects.toMatchObject({ status: 422, code: 'FILTER_SHARE_PROJECT_NOT_VISIBLE' });
    prisma.workspaceMembership.findMany.mockResolvedValue([]);
    await expect(
      service.create('w1', 'u1', {
        name: 'x',
        jql: 'project = HR',
        visibility: 'SHARED',
        sharedUserIds: ['ngoai'],
      }),
    ).rejects.toMatchObject({ status: 422, code: 'FILTER_SHARE_USER_NOT_MEMBER' });
    expect(tx.savedFilter.create).not.toHaveBeenCalled();
  });

  it('create(): SHARED không đích → 422; dự án kiểm theo người CHỦ thấy được (visibleWhere của chủ)', async () => {
    const { service, prisma, access } = make();
    await expect(
      service.create('w1', 'u1', { name: 'x', jql: 'project = HR', visibility: 'SHARED' }),
    ).rejects.toMatchObject({
      status: 422,
    });
    await service.create('w1', 'u1', {
      name: 'x',
      jql: 'project = HR',
      visibility: 'SHARED',
      sharedProjectIds: ['p1'],
    });
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(JSON.stringify(prisma.project.findMany.mock.calls[0])).toContain('"workspaceId":"w1"');
  });

  it('update(): người không phải chủ → 403, không ghi', async () => {
    const { service, prisma, tx } = make();
    prisma.savedFilter.findFirst.mockResolvedValueOnce(row({ ownerId: 'u2' }));
    await expect(service.update('w1', 'u1', 'f1', { name: 'x' })).rejects.toMatchObject({
      status: 403,
    });
    expect(tx.savedFilter.update).not.toHaveBeenCalled();
  });

  it('update()/softDelete(): người KHÔNG thấy bộ lọc → 404 (không lộ tồn tại); thấy mà không phải chủ → 403', async () => {
    const { service, prisma, tx } = make();
    prisma.savedFilter.findFirst.mockResolvedValue(null);
    await expect(service.update('w1', 'u9', 'f1', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    await expect(service.softDelete('w1', 'u9', 'f1')).rejects.toBeInstanceOf(NotFoundAppException);
    expect(tx.savedFilter.update).not.toHaveBeenCalled();
  });

  it('update(): đọc hiện trạng + khoá hàng + kiểm đích nằm trong giao dịch', async () => {
    const { service, prisma, tx } = make();
    prisma.savedFilter.findFirst.mockResolvedValue(
      row({ visibility: 'SHARED', userShares: [{ user: person('b') }] }),
    );
    await service.update('w1', 'u1', 'f1', { sharedUserIds: ['b', 'c'] });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.savedFilterUserShare.createMany).toHaveBeenCalled();
  });

  it('shareLapsed: bộ lọc SHARED nhưng không còn đích sống → trả PRIVATE; chỉ chủ thấy cờ', async () => {
    const lapsedRow = row({ visibility: 'SHARED', ownerId: 'u2', owner: person('u2') });
    const asOwner = make();
    asOwner.prisma.savedFilter.findMany.mockResolvedValue([lapsedRow]);
    const [o] = await asOwner.service.list('w1', 'u2');
    expect(o).toMatchObject({ visibility: 'PRIVATE', shareLapsed: true });
    const asOther = make();
    asOther.prisma.savedFilter.findMany.mockResolvedValue([lapsedRow]);
    const [v] = await asOther.service.list('w1', 'u1');
    expect(v!.shareLapsed).toBeUndefined();
  });

  it('update(): chỉ đổi tên không chạm bảng chia sẻ; thông báo chỉ cho người MỚI', async () => {
    const { service, prisma, tx, notifications } = make();
    const cur = row({ visibility: 'SHARED', userShares: [{ user: person('b') }] });
    prisma.savedFilter.findFirst.mockResolvedValue(cur);
    await service.update('w1', 'u1', 'f1', { name: 'mới' });
    expect(tx.savedFilterUserShare.deleteMany).not.toHaveBeenCalled();
    expect(notifications.publish).not.toHaveBeenCalled();
    await service.update('w1', 'u1', 'f1', { sharedUserIds: ['b', 'c'] });
    expect(notifications.publish).toHaveBeenCalledTimes(1);
    expect(notifications.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'c',
        type: 'FILTER_SHARED',
        actorId: 'u1',
        payload: { filterId: 'f1', filterName: 'n' },
      }),
    );
  });

  it('thông báo thất bại không làm hỏng việc lưu chia sẻ', async () => {
    const { service, notifications } = make();
    notifications.publish.mockRejectedValue(new Error('boom'));
    await expect(
      service.create('w1', 'u1', {
        name: 'x',
        jql: 'project = HR',
        visibility: 'SHARED',
        sharedUserIds: ['b'],
      }),
    ).resolves.toBeDefined();
  });

  it('bỏ chia sẻ (PRIVATE) xoá hết đích', async () => {
    const { service, prisma, tx } = make();
    prisma.savedFilter.findFirst.mockResolvedValue(
      row({
        visibility: 'SHARED',
        projectShares: [{ project: P }],
        userShares: [{ user: person('b') }],
      }),
    );
    await service.update('w1', 'u1', 'f1', { visibility: 'PRIVATE' });
    expect(tx.savedFilterProjectShare.deleteMany).toHaveBeenCalledWith({
      where: { filterId: 'f1', projectId: { notIn: [] } },
    });
    expect(tx.savedFilterUserShare.deleteMany).toHaveBeenCalledWith({
      where: { filterId: 'f1', userId: { notIn: [] } },
    });
    expect(tx.savedFilterUserShare.createMany).not.toHaveBeenCalled();
  });
});
