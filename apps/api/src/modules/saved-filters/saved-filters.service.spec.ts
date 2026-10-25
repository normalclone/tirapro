import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { SavedFiltersService } from './saved-filters.service';

const VISIBLE = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

function make(visibleIds: string[] | null = ['p1']) {
  const row = {
    id: 'f1',
    name: 'n',
    jql: 'project = HR',
    visibility: 'WORKSPACE',
    sharedProjectId: null,
    ownerId: 'u2',
    createdAt: new Date('2026-10-16T00:00:00Z'),
  };
  const prisma = {
    savedFilter: {
      findMany: vi.fn(() => Promise.resolve([row])),
      findFirst: vi.fn((_a: unknown) => Promise.resolve(row as typeof row | null)),
      create: vi.fn(() => Promise.resolve(row)),
      update: vi.fn(() => Promise.resolve(row)),
    },
  };
  const search = { search: vi.fn(() => Promise.resolve({ data: [], meta: {} })) };
  const access = {
    visibleWhere: vi.fn(() => Promise.resolve(visibleIds === null ? {} : VISIBLE)),
    assertCanSee: vi.fn(() => Promise.resolve()),
  };
  const service = new SavedFiltersService(prisma as never, search as never, access as never);
  return { service, prisma, search, access };
}

describe('SavedFiltersService — dự án riêng tư (P13)', () => {
  it('run(): chạy JQL với người xem (SearchService lọc dự án riêng tư theo currentUserId)', async () => {
    const { service, search } = make();
    await service.run('w1', 'u1', 'f1', { limit: 50 });
    expect(search.search).toHaveBeenCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ jql: 'project = HR' }),
    );
  });

  it('list(): bộ lọc người khác chia sẻ gắn dự án riêng tư không thấy → bị loại khỏi điều kiện', async () => {
    const { service, prisma } = make(['p1']);
    await service.list('w1', 'u1');
    const where = JSON.stringify(
      (prisma.savedFilter.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    );
    expect(where).toContain('"ownerId":"u1"');
    expect(where).toContain('"sharedProject":' + JSON.stringify(VISIBLE));
    expect(where).toContain('"sharedProjectId":null');
  });

  it('list(): admin (thấy mọi dự án) → không thêm ràng buộc dự án', async () => {
    const { service, prisma } = make(null);
    await service.list('w1', 'u1');
    const where = JSON.stringify(
      (prisma.savedFilter.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    );
    expect(where).not.toContain('sharedProjectId');
  });

  it('run(): bộ lọc gắn dự án ẩn → 404 "Bộ lọc" như không tồn tại (điều kiện đã nằm trong where)', async () => {
    const { service, prisma, search } = make(['p1']);
    prisma.savedFilter.findFirst.mockResolvedValue(null);
    await expect(service.run('w1', 'u1', 'f1', { limit: 50 })).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    const where = JSON.stringify(
      (prisma.savedFilter.findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    );
    expect(where).toContain('"sharedProject":' + JSON.stringify(VISIBLE));
    expect(search.search).not.toHaveBeenCalled();
  });

  it('create(): gắn sharedProjectId vào dự án riêng tư không thấy → 404', async () => {
    const { service, access, prisma } = make();
    access.assertCanSee.mockRejectedValue(new NotFoundAppException('Dự án'));
    await expect(
      service.create('w1', 'u1', {
        name: 'x',
        jql: 'project = HR',
        visibility: 'PROJECT',
        sharedProjectId: 'hr',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.savedFilter.create).not.toHaveBeenCalled();
  });
});

describe('SavedFiltersService — mức "Dự án" bắt buộc có dự án', () => {
  it('create(): PROJECT không kèm dự án → 422, không ghi', async () => {
    const { service, prisma } = make();
    for (const sharedProjectId of [null, undefined]) {
      await expect(
        service.create('w1', 'u1', {
          name: 'x',
          jql: 'project = HR',
          visibility: 'PROJECT',
          sharedProjectId,
        }),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(prisma.savedFilter.create).not.toHaveBeenCalled();
  });
  it('update(): đổi sang PROJECT không kèm dự án → 422; gỡ dự án của bộ lọc đang PROJECT → 422', async () => {
    const { service, prisma } = make();
    prisma.savedFilter.findFirst.mockResolvedValueOnce({
      id: 'f1',
      name: 'n',
      jql: 'a = b',
      visibility: 'WORKSPACE',
      sharedProjectId: null,
      ownerId: 'u1',
      createdAt: new Date(),
    });
    await expect(service.update('w1', 'u1', 'f1', { visibility: 'PROJECT' })).rejects.toMatchObject(
      { status: 422 },
    );
    prisma.savedFilter.findFirst.mockResolvedValueOnce({
      id: 'f1',
      name: 'n',
      jql: 'a = b',
      visibility: 'PROJECT',
      sharedProjectId: 'p1',
      ownerId: 'u1',
      createdAt: new Date(),
    } as never);
    await expect(service.update('w1', 'u1', 'f1', { sharedProjectId: null })).rejects.toMatchObject(
      { status: 422 },
    );
    expect(prisma.savedFilter.update).not.toHaveBeenCalled();
  });
  it('update(): bộ lọc CŨ đang PROJECT + null vẫn đổi tên được, và vẫn rời được sang mức khác', async () => {
    const { service, prisma } = make();
    const legacy = {
      id: 'f1',
      name: 'n',
      jql: 'a = b',
      visibility: 'PROJECT',
      sharedProjectId: null,
      ownerId: 'u1',
      createdAt: new Date(),
    };
    prisma.savedFilter.findFirst.mockResolvedValueOnce(legacy);
    await expect(service.update('w1', 'u1', 'f1', { name: 'mới' })).resolves.toBeDefined();
    prisma.savedFilter.findFirst.mockResolvedValueOnce(legacy);
    await expect(
      service.update('w1', 'u1', 'f1', { visibility: 'WORKSPACE', sharedProjectId: null }),
    ).resolves.toBeDefined();
    expect(prisma.savedFilter.update).toHaveBeenCalledTimes(2);
  });
  it('create()/update() đủ dự án vẫn qua (và vẫn đi qua kiểm quyền thấy dự án)', async () => {
    const { service, access, prisma } = make();
    await service.create('w1', 'u1', {
      name: 'x',
      jql: 'project = HR',
      visibility: 'PROJECT',
      sharedProjectId: 'hr',
    });
    expect(access.assertCanSee).toHaveBeenCalledWith('u1', 'w1', 'hr', 'Dự án');
    expect(prisma.savedFilter.create).toHaveBeenCalledTimes(1);
  });
});
