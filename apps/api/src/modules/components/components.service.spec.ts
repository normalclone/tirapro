import { describe, expect, it, vi } from 'vitest';
import { ComponentsService } from './components.service';

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

function setup(archived: boolean) {
  const prisma = {
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: archived ? new Date() : null })),
    },
    component: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'c1', projectId: 'p1' })),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    version: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'v1', projectId: 'p1' })),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
  };
  return { service: new ComponentsService(prisma as never), prisma };
}

describe('ComponentsService — hạng mục/phiên bản của dự án lưu trữ là chỉ đọc', () => {
  it('create/update/remove component => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(service.createComponent('w1', 'p1', { name: 'C' })).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.updateComponent('w1', 'c1', { name: 'Mới' })).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.removeComponent('w1', 'c1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.component.create).not.toHaveBeenCalled();
    expect(prisma.component.update).not.toHaveBeenCalled();
    expect(prisma.component.delete).not.toHaveBeenCalled();
  });

  it('create/update/remove version => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(service.createVersion('w1', 'p1', { name: 'v1' })).rejects.toMatchObject(ARCHIVED);
    await expect(service.updateVersion('w1', 'v1', { name: 'v2' })).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeVersion('w1', 'v1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.version.create).not.toHaveBeenCalled();
    expect(prisma.version.update).not.toHaveBeenCalled();
    expect(prisma.version.delete).not.toHaveBeenCalled();
  });

  it('dự án đang hoạt động => ghi bình thường', async () => {
    const { service, prisma } = setup(false);
    prisma.component.update.mockResolvedValue({ id: 'c1', projectId: 'p1', name: 'x' });
    await service.updateComponent('w1', 'c1', { name: 'x' });
    await service.removeVersion('w1', 'v1');
    expect(prisma.component.update).toHaveBeenCalledOnce();
    expect(prisma.version.delete).toHaveBeenCalledOnce();
  });
});
