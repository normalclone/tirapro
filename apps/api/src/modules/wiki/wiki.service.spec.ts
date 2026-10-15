import { describe, expect, it, vi } from 'vitest';
import { WikiService } from './wiki.service';

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

function setup(archived: boolean, pageProjectId: string | null = 'p1') {
  const archivedAt = archived ? new Date() : null;
  const page = { id: 'g1', projectId: pageProjectId, parentId: null, title: 'T' };
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
    $transaction: vi.fn(() => Promise.resolve([])),
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
