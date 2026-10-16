import { describe, expect, it, vi } from 'vitest';
import { WikiService } from './wiki.service';
import { updateWikiPageSchema } from './wiki.schemas';

describe('WikiService.search — escape ký tự đại diện LIKE', () => {
  it('q="_" / "50%" được escape (không khớp mọi trang), tìm cả title và body', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new WikiService({ wikiPage: { findMany } } as never);
    await service.search('w1', '_');
    await service.search('w1', '50%');
    const calls = findMany.mock.calls as unknown as Array<[{ where: { OR: unknown[] } }]>;
    expect(calls[0]![0].where.OR).toEqual([
      { title: { contains: '\\_', mode: 'insensitive' } },
      { body: { contains: '\\_', mode: 'insensitive' } },
    ]);
    expect(JSON.stringify(calls[1]![0].where.OR)).toContain('"contains":"50\\\\%"');
  });
});

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

type Member = { user: { id: string; displayName: string } };

function setup(archived: boolean, pageProjectId: string | null = 'p1') {
  const archivedAt = archived ? new Date() : null;
  const page = {
    id: 'g1',
    workspaceId: 'w1',
    projectId: pageProjectId,
    parentId: null,
    title: 'T',
    body: '',
    order: 0,
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1', archivedAt })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt })),
    },
    wikiPage: {
      findFirst: vi.fn(() => Promise.resolve(page)),
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: 'g2' })),
      update: vi.fn(() => Promise.resolve({})),
      updateMany: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      aggregate: vi.fn(() => Promise.resolve({ _max: { order: null } })),
    },
    user: { findMany: vi.fn(() => Promise.resolve([])) },
    workspaceMembership: { findMany: vi.fn((): Promise<Member[]> => Promise.resolve([])) },
    projectMembership: { findMany: vi.fn((): Promise<Member[]> => Promise.resolve([])) },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.resolve([]),
    ),
  };
  return { service: new WikiService(prisma as never), prisma };
}

describe('WikiService — dự án lưu trữ là chỉ đọc', () => {
  it('create/update/move/remove trang của dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.create('w1', { title: 'Trang', projectId: 'p1' } as never, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.create('w1', { title: 'Con', parentId: 'g1' } as never, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.update('w1', 'g1', { title: 'Mới' }, 'u1')).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.move('w1', 'g1', { order: 0 }, 'u1')).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 'g1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.wikiPage.create).not.toHaveBeenCalled();
    expect(prisma.wikiPage.update).not.toHaveBeenCalled();
    expect(prisma.wikiPage.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trang chung của workspace vẫn xoá được', async () => {
    const { service, prisma } = setup(true, null);
    await service.remove('w1', 'g1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('WikiService.create — phạm vi trang con khớp trang cha (A8)', () => {
  it('parentId thuộc dự án khác body.projectId → 422, không ghi (chặn leo thang đặc quyền)', async () => {
    const { service, prisma } = setup(false, 'pQ'); // trang cha thuộc dự án pQ
    await expect(
      service.create('w1', { title: 'x', body: '', projectId: 'pP', parentId: 'g1' }, 'u1'),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.wikiPage.create).not.toHaveBeenCalled();
  });

  it('trang cha chung (null) nhưng body.projectId có giá trị → 422', async () => {
    const { service, prisma } = setup(false, null);
    await expect(
      service.create('w1', { title: 'x', body: '', projectId: 'pP', parentId: 'g1' }, 'u1'),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.wikiPage.create).not.toHaveBeenCalled();
  });

  it('parentId + cùng projectId → tạo được', async () => {
    const { service, prisma } = setup(false, 'pQ');
    await service.create('w1', { title: 'x', body: '', projectId: 'pQ', parentId: 'g1' }, 'u1');
    expect(prisma.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: 'pQ', parentId: 'g1' }) as unknown,
      }),
    );
  });

  it('parentId + cùng null (trang chung) → tạo được', async () => {
    const { service, prisma } = setup(false, null);
    await service.create('w1', { title: 'x', body: '', parentId: 'g1' }, 'u1');
    expect(prisma.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: null, parentId: 'g1' }) as unknown,
      }),
    );
  });
});

describe('WikiService.admins — "xin ai" cấp quyền / xoá trang (A9)', () => {
  const user = (id: string, displayName: string) => ({ user: { id, displayName } });

  it('gộp quản trị workspace + dự án, khử trùng, sắp theo tên', async () => {
    const { service, prisma } = setup(false);
    prisma.workspaceMembership.findMany.mockResolvedValueOnce([user('a', 'An')]);
    prisma.projectMembership.findMany.mockResolvedValueOnce([user('b', 'Bình'), user('a', 'An')]);
    await expect(service.admins('w1', 'p1')).resolves.toEqual([
      { id: 'a', displayName: 'An' },
      { id: 'b', displayName: 'Bình' },
    ]);
    const has = {
      permissions: { some: { permission: { key: 'project:admin' } } },
    };
    const active = { status: { not: 'DEACTIVATED' } };
    expect(prisma.workspaceMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'w1',
          user: active,
          OR: [{ role: has }, { roles: { some: { role: has } } }],
        },
        take: 8,
      }),
    );
    expect(prisma.projectMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'p1',
          user: active,
          OR: [{ role: has }, { roles: { some: { role: has } } }],
        },
      }),
    );
  });

  it.each([undefined, 'none'])('projectId=%s → chỉ hỏi quản trị workspace', async (projectId) => {
    const { service, prisma } = setup(false);
    prisma.workspaceMembership.findMany.mockResolvedValueOnce([user('a', 'An')]);
    await expect(service.admins('w1', projectId)).resolves.toEqual([
      { id: 'a', displayName: 'An' },
    ]);
    expect(prisma.projectMembership.findMany).not.toHaveBeenCalled();
  });

  it('tối đa 8 người sau khi gộp', async () => {
    const { service, prisma } = setup(false);
    prisma.workspaceMembership.findMany.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, i) => user(`w${i}`, `Ws ${i}`)),
    );
    prisma.projectMembership.findMany.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, i) => user(`p${i}`, `Pr ${i}`)),
    );
    expect(await service.admins('w1', 'p1')).toHaveLength(8);
  });
});

describe('WikiService.update — chống ghi đè theo updatedAt (A10)', () => {
  const EXPECTED = '2026-10-01T00:00:00.000Z';

  it('expectedUpdatedAt lệch → VersionConflictException (409), không ghi', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.update('w1', 'g1', { body: 'mới', expectedUpdatedAt: EXPECTED }, 'u1'),
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(prisma.wikiPage.update).not.toHaveBeenCalled();
  });

  it('khớp → updateMany có where.updatedAt đúng (kiểm-và-ghi một câu lệnh)', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.update('w1', 'g1', { body: 'mới', expectedUpdatedAt: EXPECTED }, 'u1');
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'g1', workspaceId: 'w1', updatedAt: new Date(EXPECTED) },
        data: expect.objectContaining({ body: 'mới', updatedById: 'u1' }) as unknown,
      }),
    );
  });

  it('không gửi expectedUpdatedAt → vẫn dùng update thường (tương thích client cũ)', async () => {
    const { service, prisma } = setup(false);
    await service.update('w1', 'g1', { body: 'mới' }, 'u1');
    expect(prisma.wikiPage.update).toHaveBeenCalled();
    expect(prisma.wikiPage.updateMany).not.toHaveBeenCalled();
  });

  it('schema: expectedUpdatedAt phải là ISO datetime', () => {
    expect(
      updateWikiPageSchema.safeParse({ body: 'x', expectedUpdatedAt: 'hôm qua' }).success,
    ).toBe(false);
    expect(updateWikiPageSchema.safeParse({ body: 'x', expectedUpdatedAt: EXPECTED }).success).toBe(
      true,
    );
  });
});
