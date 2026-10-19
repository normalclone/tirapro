import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ConfigCatalogService } from './config-catalog.service';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

describe('ConfigCatalogService — chữ hiển thị "Mức ưu tiên"', () => {
  it('tạo trùng tên → thông báo gọi là "Mức ưu tiên", không phải "Độ ưu tiên"', async () => {
    const prisma = { priority: { create: vi.fn(() => Promise.reject(p2002())) } };
    const svc = new ConfigCatalogService(prisma as never);
    const err = await svc.createPriority('w1', { name: 'Cao' }).catch((e: Error) => e);
    expect((err as Error).message).toContain('Mức ưu tiên');
    expect((err as Error).message).not.toContain('Độ ưu tiên');
  });

  it('sửa/xoá mục không có → "Mức ưu tiên không tồn tại"', async () => {
    const prisma = { priority: { findFirst: vi.fn(() => Promise.resolve(null)) } };
    const svc = new ConfigCatalogService(prisma as never);
    const err = await svc.removePriority('w1', 'x').catch((e: Error) => e);
    expect((err as Error).message).toBe('Mức ưu tiên không tồn tại');
  });
});
