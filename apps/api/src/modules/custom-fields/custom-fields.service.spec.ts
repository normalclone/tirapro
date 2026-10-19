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
  const access = {
    visibleWhere: vi.fn(
      (..._a: unknown[]): Promise<Record<string, unknown>> => Promise.resolve({}),
    ),
  };
  return { service: new CustomFieldsService(prisma as never, access as never), prisma, access };
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

describe('CustomFieldsService.listDefinitions — dự án riêng tư (P15)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const list = (p: { customField: object }) =>
    p as unknown as {
      customField: { findMany: { mock: { calls: { where: object }[][] } } };
    };

  it('không có projectId: chỉ field chung + field của dự án thấy được (người ngoài không thấy field dự án ẩn)', async () => {
    const { service, prisma, access } = setup(false);
    (prisma.customField as Record<string, unknown>).findMany = vi.fn(() => Promise.resolve([]));
    access.visibleWhere.mockResolvedValue(visible);
    await service.listDefinitions('w1', undefined, 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(list(prisma).customField.findMany.mock.calls[0]![0]!.where).toEqual({
      workspaceId: 'w1',
      deletedAt: null,
      OR: [{ projectId: null }, { project: visible }],
    });
  });

  it('thấy hết (admin) → không thêm điều kiện; có projectId → như cũ (guard đã 404 dự án ẩn)', async () => {
    const { service, prisma } = setup(false);
    (prisma.customField as Record<string, unknown>).findMany = vi.fn(() => Promise.resolve([]));
    await service.listDefinitions('w1', undefined, 'u1');
    expect(list(prisma).customField.findMany.mock.calls[0]![0]!.where).toEqual({
      workspaceId: 'w1',
      deletedAt: null,
    });
    await service.listDefinitions('w1', 'p1', 'u1');
    expect(list(prisma).customField.findMany.mock.calls[1]![0]!.where).toEqual({
      workspaceId: 'w1',
      deletedAt: null,
      OR: [{ projectId: 'p1' }, { projectId: null }],
    });
  });
});
