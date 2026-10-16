import { describe, expect, it, vi } from 'vitest';
import { RaidService } from './raid.service';

/** ProjectAccessService giả: người xem thấy mọi dự án (admin) / không có viewer. */
const ACCESS_ALL = { visibleWhere: vi.fn(() => Promise.resolve({})) };

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
  return {
    service: new RaidService(prisma as never, rbac as never, ACCESS_ALL as never),
    prisma,
    rbac,
  };
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

describe('RaidService — dự án riêng tư (P14)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const whereOf = (fn: ReturnType<typeof vi.fn>, i = 0) =>
    (fn.mock.calls[i] as unknown as [{ where: unknown }])[0].where;

  function make() {
    const prisma = {
      raidItem: {
        findMany: vi.fn((_a?: unknown) => Promise.resolve([raidRow()])),
        findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)),
      },
      project: { findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)) },
    };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visible)) };
    const service = new RaidService(prisma as never, {} as never, access as never);
    return { service, prisma, access };
  }

  it('list(w, filter, viewer): mục cấp workspace luôn hiện; mục gắn dự án chỉ khi dự án thấy được', async () => {
    const { service, prisma, access } = make();
    await service.list('w1', { kind: 'RISK' }, 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(whereOf(prisma.raidItem.findMany)).toMatchObject({
      workspaceId: 'w1',
      kind: 'RISK',
      OR: [{ projectId: null }, { project: visible }],
    });
  });

  it('list không viewer → không thêm điều kiện dự án', async () => {
    const { service, prisma, access } = make();
    await service.list('w1', {});
    expect(access.visibleWhere).not.toHaveBeenCalled();
    expect(JSON.stringify(whereOf(prisma.raidItem.findMany))).not.toContain('isPrivate');
  });

  it('get(w, id, viewer): mục của dự án riêng tư không thấy → 404 "Mục rủi ro" như không tồn tại', async () => {
    const { service, prisma } = make();
    await expect(service.get('w1', 'r1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(whereOf(prisma.raidItem.findFirst)).toMatchObject({
      id: 'r1',
      workspaceId: 'w1',
      OR: [{ projectId: null }, { project: visible }],
    });
  });

  it('create/update: gắn vào dự án riêng tư không thấy → 404 "Dự án" như dự án không tồn tại', async () => {
    const { service, prisma } = make();
    await expect(service.create('w1', { title: 'R', projectId: 'hr' }, 'u1')).rejects.toMatchObject(
      { status: 404 },
    );
    expect(whereOf(prisma.project.findFirst)).toMatchObject({ id: 'hr', ...visible });
  });
});
