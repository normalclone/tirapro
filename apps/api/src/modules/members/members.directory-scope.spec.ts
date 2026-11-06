import { describe, expect, it, vi } from 'vitest';
import { MembersService } from './members.service';

/** Danh bạ tổ chức: người không quản lý chỉ thấy mình + người cùng dự án (spec vai trò theo dự án, mục D). */
describe('MembersService.listOrganization — phạm vi danh bạ', () => {
  const userRow = (id: string) => ({
    id,
    email: `${id}@x.vn`,
    displayName: id,
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'vi',
    status: 'ACTIVE',
    isSystemAdmin: false,
    lastSeenAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  });
  const orgRow = (id: string) => ({
    id: `m-${id}`,
    joinedAt: null,
    roleId: 'r1',
    role: { id: 'r1', name: 'Organization Member', color: null },
    user: userRow(id),
    roles: [],
  });

  function setup(mine: unknown[], peers: Array<{ userId: string }> = []) {
    const orgFind = vi.fn(() => Promise.resolve([orgRow('v')]));
    const pmFind = vi.fn().mockResolvedValueOnce(mine).mockResolvedValueOnce(peers);
    const prisma = {
      organizationMembership: { findMany: orgFind },
      projectMembership: { findMany: pmFind },
    };
    const svc = new MembersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { grantsAdmin: vi.fn(), syncOnOrgRoles: vi.fn() } as never,
    );
    return { svc, orgFind, pmFind };
  }
  const plain = { id: 'v', permissions: ['organization:view'] };
  const noAdmin = (projectId: string) => ({ projectId, roles: [{ role: { permissions: [] } }] });

  it('member:manage / Quản trị / nội bộ: không giới hạn', async () => {
    const { svc, orgFind, pmFind } = setup([]);
    await svc.listOrganization('w1', { id: 'v', permissions: ['member:manage'] });
    await svc.listOrganization('w1', { id: 'v', isSystemAdmin: true });
    await svc.listOrganization('w1');
    expect(pmFind).not.toHaveBeenCalled();
    for (const call of orgFind.mock.calls as unknown as Array<[{ where: object }]>) {
      expect(call[0].where).toEqual({ organizationId: 'w1' });
    }
  });

  it('Project Admin của một dự án: thấy cả tổ chức (để thêm người)', async () => {
    const { svc, orgFind } = setup([
      { projectId: 'p1', roles: [{ role: { permissions: [{ roleId: 'x' }] } }] },
    ]);
    await svc.listOrganization('w1', plain);
    expect(orgFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'w1' } }),
    );
  });

  it('không tham gia dự án nào: chỉ thấy chính mình', async () => {
    const { svc, orgFind } = setup([]);
    await svc.listOrganization('w1', plain);
    expect(orgFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'w1', userId: { in: ['v'] } } }),
    );
  });

  it('thành viên thường: mình + người cùng dự án', async () => {
    const { svc, orgFind, pmFind } = setup(
      [noAdmin('p1'), noAdmin('p2')],
      [{ userId: 'a' }, { userId: 'v' }],
    );
    await svc.listOrganization('w1', plain);
    expect(pmFind.mock.calls[1]![0]).toMatchObject({
      where: { projectId: { in: ['p1', 'p2'] } },
    });
    expect(orgFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'w1', userId: { in: ['v', 'a'] } },
      }),
    );
  });
});
