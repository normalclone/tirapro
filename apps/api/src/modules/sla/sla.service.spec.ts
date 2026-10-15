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
  return { service: new SlaService(prisma as never), prisma };
}

describe('SlaService — dự án lưu trữ là chỉ đọc', () => {
  it('create/update/remove chính sách của dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.create('w1', {
        name: 'S',
        projectId: 'p1',
        responseMins: 5,
        resolveMins: 60,
      }),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.update('w1', 's1', { name: 'Mới' })).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 's1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.slaPolicy.create).not.toHaveBeenCalled();
    expect(prisma.slaPolicy.update).not.toHaveBeenCalled();
    expect(prisma.slaPolicy.deleteMany).not.toHaveBeenCalled();
  });

  it('update chuyển chính sách chung sang dự án đã lưu trữ => 422', async () => {
    const { service, prisma } = setup(true, null);
    await expect(service.update('w1', 's1', { projectId: 'p1' })).rejects.toMatchObject(ARCHIVED);
    expect(prisma.slaPolicy.update).not.toHaveBeenCalled();
  });

  it('chính sách chung (không gắn dự án) và dự án đang hoạt động vẫn ghi được', async () => {
    const shared = setup(true, null);
    await shared.service.create('w1', { name: 'S', responseMins: 5, resolveMins: 60 });
    await shared.service.remove('w1', 's1');
    expect(shared.prisma.slaPolicy.create).toHaveBeenCalled();
    expect(shared.prisma.slaPolicy.deleteMany).toHaveBeenCalled();

    const live = setup(false);
    await live.service.update('w1', 's1', { name: 'Mới' });
    expect(live.prisma.slaPolicy.update).toHaveBeenCalled();
  });
});
