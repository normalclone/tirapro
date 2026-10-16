import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { SavedFiltersService } from './saved-filters.service';

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
    visibleProjectIds: vi.fn(() => Promise.resolve(visibleIds)),
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
    expect(where).toContain('"sharedProjectId":{"in":["p1"]}');
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
    expect(where).toContain('"sharedProjectId":{"in":["p1"]}');
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
