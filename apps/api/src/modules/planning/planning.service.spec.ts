import { describe, expect, it, vi } from 'vitest';
import { PlanningService } from './planning.service';

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

function setup(archived: boolean) {
  const prisma = {
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: archived ? new Date() : null })),
    },
    milestone: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'm1' })),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    issue: { findMany: vi.fn(() => Promise.resolve([])) },
    planBaseline: { create: vi.fn(() => Promise.resolve({ id: 'b1' })) },
    planBaselineItem: { createMany: vi.fn(() => Promise.resolve({})) },
  };
  return { service: new PlanningService(prisma as never), prisma };
}

describe('PlanningService — dự án lưu trữ là chỉ đọc (cột mốc, kế hoạch gốc)', () => {
  it('create/update/remove cột mốc và createBaseline => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.createMilestone('w1', 'p1', { name: 'M', dueDate: '2026-12-01' }),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.updateMilestone('w1', 'p1', 'm1', { name: 'Mới' })).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.removeMilestone('w1', 'p1', 'm1')).rejects.toMatchObject(ARCHIVED);
    await expect(service.createBaseline('w1', 'p1', { name: 'Gốc' }, 'u1')).rejects.toMatchObject(
      ARCHIVED,
    );
    expect(prisma.milestone.create).not.toHaveBeenCalled();
    expect(prisma.milestone.update).not.toHaveBeenCalled();
    expect(prisma.milestone.delete).not.toHaveBeenCalled();
    expect(prisma.planBaseline.create).not.toHaveBeenCalled();
    expect(prisma.planBaselineItem.createMany).not.toHaveBeenCalled();
  });

  it('createMilestone trên dự án đang hoạt động vẫn ghi', async () => {
    const { service, prisma } = setup(false);
    prisma.milestone.create.mockResolvedValue({
      id: 'm2',
      projectId: 'p1',
      name: 'M',
      dueDate: new Date(),
      description: null,
      color: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.createMilestone('w1', 'p1', { name: 'M', dueDate: '2026-12-01' });
    expect(prisma.milestone.create).toHaveBeenCalledOnce();
  });
});
