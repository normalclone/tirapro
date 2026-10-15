import { describe, expect, it, vi } from 'vitest';
import { RaidService } from './raid.service';

const raidRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  workspaceId: 'w1',
  projectId: 'p1',
  kind: 'RISK',
  title: 't',
  description: null,
  probability: 3,
  impact: 3,
  status: 'OPEN',
  ownerId: null,
  mitigation: null,
  dueDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  owner: null,
  project: { id: 'p1', key: 'P', name: 'P' },
  ...over,
});

function setup(
  perms: string[] = [],
  current: { projectId: string | null } = { projectId: 'p1' },
  projectExists = true,
) {
  const prisma = {
    raidItem: {
      findFirst: vi.fn((args: { select: Record<string, unknown> }) =>
        Promise.resolve('title' in args.select ? raidRow() : { id: 'r1', ...current }),
      ),
      update: vi.fn((_args: unknown) => Promise.resolve({})),
    },
    project: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(projectExists ? { id: where.id } : null),
      ),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })),
    },
  };
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))) };
  return { service: new RaidService(prisma as never, rbac as never), prisma, rbac };
}
const member = { id: 'u1', isSystemAdmin: false };

describe('RaidService.update — đổi dự án', () => {
  it('đổi sang dự án đích mà user không có risk:manage ở đó -> 403, không ghi', async () => {
    const { service, prisma, rbac } = setup(['project:view']);
    await expect(service.update('w1', 'r1', { projectId: 'p2' }, member)).rejects.toMatchObject({
      status: 403,
    });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p2');
    expect(prisma.raidItem.update).not.toHaveBeenCalled();
  });

  it('có risk:manage ở đích -> connect dự án đích', async () => {
    const { service, prisma } = setup(['risk:manage']);
    await service.update('w1', 'r1', { projectId: 'p2' }, member);
    expect(prisma.raidItem.update.mock.calls[0]![0]).toMatchObject({
      data: { project: { connect: { id: 'p2' } } },
    });
  });

  it('gỡ khỏi dự án (về cấp workspace) kiểm quyền cấp workspace (projectId=null)', async () => {
    const { service, rbac } = setup([]);
    await expect(service.update('w1', 'r1', { projectId: null }, member)).rejects.toMatchObject({
      status: 403,
    });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', null);
  });

  it('projectId không đổi -> không kiểm quyền thêm', async () => {
    const { service, rbac } = setup([]);
    await service.update('w1', 'r1', { projectId: 'p1', title: 'mới' }, member);
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('system admin bỏ qua kiểm quyền đích', async () => {
    const { service, rbac, prisma } = setup([]);
    await service.update('w1', 'r1', { projectId: 'p2' }, { id: 'u9', isSystemAdmin: true });
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
    expect(prisma.raidItem.update).toHaveBeenCalledTimes(1);
  });

  it('dự án đích ngoài workspace -> 404, không hỏi quyền, không ghi', async () => {
    const { service, prisma, rbac } = setup(['risk:manage'], { projectId: 'p1' }, false);
    await expect(service.update('w1', 'r1', { projectId: 'px' }, member)).rejects.toMatchObject({
      status: 404,
    });
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
    expect(prisma.raidItem.update).not.toHaveBeenCalled();
  });

  it('chuyển từ cấp workspace vào dự án: kiểm risk:manage ở dự án đích', async () => {
    const denied = setup([], { projectId: null });
    await expect(
      denied.service.update('w1', 'r1', { projectId: 'p2' }, member),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(denied.rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p2');
    const ok = setup(['risk:manage'], { projectId: null });
    await ok.service.update('w1', 'r1', { projectId: 'p2' }, member);
    expect(ok.prisma.raidItem.update.mock.calls[0]![0]).toMatchObject({
      data: { project: { connect: { id: 'p2' } } },
    });
  });
});
