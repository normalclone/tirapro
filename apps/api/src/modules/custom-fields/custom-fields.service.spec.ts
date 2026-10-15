import { describe, expect, it, vi } from 'vitest';
import { CustomFieldsService } from './custom-fields.service';

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

function setup(archived: boolean, fieldProjectId: string | null = 'p1') {
  const field = {
    id: 'f1',
    workspaceId: 'w1',
    projectId: fieldProjectId,
    name: 'F',
    type: 'TEXT',
    isRequired: false,
    order: 0,
    deletedAt: null,
    options: [],
  };
  const prisma = {
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: archived ? new Date() : null })),
    },
    customField: {
      findFirst: vi.fn(() => Promise.resolve(field)),
      create: vi.fn(() => Promise.resolve(field)),
      update: vi.fn(() => Promise.resolve(field)),
    },
  };
  return { service: new CustomFieldsService(prisma as never), prisma };
}

describe('CustomFieldsService — định nghĩa trường của dự án lưu trữ là chỉ đọc', () => {
  it('create (có projectId)/update/softDelete => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.createDefinition('w1', { name: 'F', type: 'TEXT', projectId: 'p1' } as never),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.updateDefinition('w1', 'f1', { name: 'Mới' })).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.softDeleteDefinition('w1', 'f1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.customField.create).not.toHaveBeenCalled();
    expect(prisma.customField.update).not.toHaveBeenCalled();
  });

  it('định nghĩa cấp workspace (không gắn dự án) không bị chặn', async () => {
    const { service, prisma } = setup(true, null);
    await service.createDefinition('w1', { name: 'F', type: 'TEXT' } as never);
    await service.updateDefinition('w1', 'f1', { name: 'Mới' });
    await service.softDeleteDefinition('w1', 'f1');
    expect(prisma.customField.create).toHaveBeenCalledOnce();
    expect(prisma.customField.update).toHaveBeenCalledTimes(2);
  });
});
