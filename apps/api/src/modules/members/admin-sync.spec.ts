import { describe, expect, it, vi } from 'vitest';
import { AdminSyncService } from './admin-sync';

const sync = new AdminSyncService();

interface Opts {
  isSystemAdmin?: boolean;
  /** Số vai trò quản trị trong bộ đang hỏi (role.count). */
  adminRoleCount?: number;
  /** Số tổ chức KHÁC mà người này còn là Quản trị. */
  adminElsewhere?: number;
  /** Danh sách Quản trị hệ thống đang hoạt động (khoá FOR UPDATE). */
  admins?: string[];
  memberships?: unknown[];
  orgs?: { id: string }[];
  userMissing?: boolean;
}

function mockTx(o: Opts = {}) {
  const roleFind = vi.fn((a: { where: { name: string } }) =>
    Promise.resolve({ id: a.where.name === 'Organization Admin' ? 'rAdmin' : 'rMember' }),
  );
  const tx = {
    user: {
      findUnique: vi.fn(() =>
        Promise.resolve(o.userMissing ? null : { isSystemAdmin: o.isSystemAdmin ?? false }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    role: { count: vi.fn(() => Promise.resolve(o.adminRoleCount ?? 0)), findFirst: roleFind },
    organizationMembership: {
      count: vi.fn(() => Promise.resolve(o.adminElsewhere ?? 0)),
      findMany: vi.fn(() => Promise.resolve(o.memberships ?? [])),
      update: vi.fn(() => Promise.resolve({})),
      create: vi.fn(() => Promise.resolve({})),
    },
    organizationMembershipRole: {
      create: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({})),
    },
    organization: { findMany: vi.fn(() => Promise.resolve(o.orgs ?? [])) },
    $queryRaw: vi.fn(() => Promise.resolve((o.admins ?? ['u1', 'u9']).map((id) => ({ id })))),
  };
  return tx;
}
type Tx = Parameters<AdminSyncService['grantsAdmin']>[0];
const asTx = (t: object) => t as unknown as Tx;

describe('grantsAdmin', () => {
  it('bộ vai trò có vai trò mang organization:admin → true; rỗng → false, không truy vấn', async () => {
    const t = mockTx({ adminRoleCount: 1 });
    expect(await sync.grantsAdmin(asTx(t), ['r1', 'r2'])).toBe(true);
    expect(t.role.count).toHaveBeenCalledWith({
      where: {
        id: { in: ['r1', 'r2'] },
        permissions: { some: { permission: { key: 'organization:admin' } } },
      },
    });
    const none = mockTx();
    expect(await sync.grantsAdmin(asTx(none), [])).toBe(false);
    expect(none.role.count).not.toHaveBeenCalled();
    expect(await sync.grantsAdmin(asTx(mockTx({ adminRoleCount: 0 })), ['r1'])).toBe(false);
  });
});

describe('assertNotLastAdmin', () => {
  it('khoá hàng admin (FOR UPDATE) trong transaction; người cuối cùng → 422 tiếng Việt', async () => {
    const t = mockTx({ admins: ['u1'] });
    await expect(sync.assertNotLastAdmin(asTx(t), 'u1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Quản trị cuối cùng') as string,
    });
    expect(t.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (t.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('');
    expect(sql).toContain('FOR UPDATE');
  });
  it('còn Quản trị khác, hoặc người này không phải Quản trị → qua', async () => {
    await expect(
      sync.assertNotLastAdmin(asTx(mockTx({ admins: ['u1', 'u2'] })), 'u1'),
    ).resolves.toBeUndefined();
    await expect(
      sync.assertNotLastAdmin(asTx(mockTx({ admins: ['u2'] })), 'u1'),
    ).resolves.toBeUndefined();
  });
});

describe('syncOnOrgRoles — vai trò tổ chức → cờ isSystemAdmin', () => {
  it('thường → Quản trị: đặt isSystemAdmin = true, báo cờ đổi', async () => {
    const t = mockTx({ isSystemAdmin: false });
    expect(await sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', false, true)).toBe(true);
    expect(t.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isSystemAdmin: true },
    });
  });
  it('thường → Quản trị mà đã là Quản trị hệ thống → không ghi, không báo đổi', async () => {
    const t = mockTx({ isSystemAdmin: true });
    expect(await sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', false, true)).toBe(false);
    expect(t.user.update).not.toHaveBeenCalled();
  });
  it('Quản trị → thường, không còn Quản trị ở tổ chức nào: isSystemAdmin = false', async () => {
    const t = mockTx({ isSystemAdmin: true, adminElsewhere: 0, admins: ['u1', 'u2'] });
    expect(await sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', true, false)).toBe(true);
    expect(t.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isSystemAdmin: false },
    });
    // chỉ tính tổ chức KHÁC tổ chức đang đổi
    expect(t.organizationMembership.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', organizationId: { not: 'w1' } }) as object,
      }),
    );
  });
  it('Quản trị → thường nhưng còn là Quản trị ở tổ chức khác → GIỮ cờ', async () => {
    const t = mockTx({ isSystemAdmin: true, adminElsewhere: 1 });
    expect(await sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', true, false)).toBe(false);
    expect(t.user.update).not.toHaveBeenCalled();
  });
  it('Quản trị → thường mà là Quản trị CUỐI CÙNG → 422, không ghi', async () => {
    const t = mockTx({ isSystemAdmin: true, adminElsewhere: 0, admins: ['u1'] });
    await expect(sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', true, false)).rejects.toMatchObject({
      status: 422,
    });
    expect(t.user.update).not.toHaveBeenCalled();
  });
  it('không đổi trạng thái (admin→admin, thường→thường) → không đụng cờ, không truy vấn (admin hệ thống chưa thuộc tổ chức giữ nguyên)', async () => {
    for (const [was, is] of [
      [true, true],
      [false, false],
    ] as const) {
      const t = mockTx({ isSystemAdmin: true });
      expect(await sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', was, is)).toBe(false);
      expect(t.user.findUnique).not.toHaveBeenCalled();
      expect(t.user.update).not.toHaveBeenCalled();
    }
  });
  it('người không còn tồn tại → không làm gì', async () => {
    const t = mockTx({ userMissing: true });
    expect(await sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', false, true)).toBe(false);
  });
  it('Thường → Quản trị nhưng người đó chưa phải isSystemAdmin của tổ chức khác không liên quan: chỉ tra DB một lần', async () => {
    const t = mockTx({ isSystemAdmin: false });
    await sync.syncOnOrgRoles(asTx(t), 'u1', 'w1', false, true);
    expect(t.organizationMembership.count).not.toHaveBeenCalled();
  });
});

describe('setAdmin — bật/tắt "Quản trị" ở Quản trị › Tài khoản', () => {
  const m = (organizationId: string, roleIds: string[]) => ({
    id: `m-${organizationId}`,
    organizationId,
    roles: roleIds.map((roleId) => ({ roleId })),
  });

  it('bật: thêm vai trò Organization Admin ở MỌI tổ chức người đó thuộc (làm vai trò chính), đặt cờ', async () => {
    const t = mockTx({
      isSystemAdmin: false,
      memberships: [m('w1', ['rMember']), m('w2', ['rAdmin'])],
    });
    const res = await sync.setAdmin(asTx(t), 'u1', true);
    expect(res).toEqual({ organizationIds: ['w1', 'w2'], flagChanged: true });
    // w1 chưa có → thêm; w2 đã có → không thêm trùng
    expect(t.organizationMembershipRole.create).toHaveBeenCalledTimes(1);
    expect(t.organizationMembershipRole.create).toHaveBeenCalledWith({
      data: { membershipId: 'm-w1', roleId: 'rAdmin' },
    });
    expect(t.organizationMembership.update).toHaveBeenCalledTimes(2);
    expect(t.organizationMembership.update).toHaveBeenCalledWith({
      where: { id: 'm-w1' },
      data: { roleId: 'rAdmin' },
    });
    expect(t.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isSystemAdmin: true },
    });
  });

  it('bật khi chưa thuộc tổ chức nào: đúng MỘT tổ chức đang hoạt động → thêm vào đó với vai trò Quản trị', async () => {
    const t = mockTx({ memberships: [], orgs: [{ id: 'w1' }] });
    const res = await sync.setAdmin(asTx(t), 'u1', true);
    expect(res.organizationIds).toEqual(['w1']);
    expect(t.organizationMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'w1',
        userId: 'u1',
        roleId: 'rAdmin',
        roles: { create: [{ roleId: 'rAdmin' }] },
      }) as object,
    });
  });

  it('bật khi chưa thuộc tổ chức nào và có NHIỀU tổ chức → chỉ đặt cờ, không thêm vào đâu', async () => {
    const t = mockTx({ memberships: [], orgs: [{ id: 'w1' }, { id: 'w2' }] });
    const res = await sync.setAdmin(asTx(t), 'u1', true);
    expect(res).toEqual({ organizationIds: [], flagChanged: true });
    expect(t.organizationMembership.create).not.toHaveBeenCalled();
    expect(t.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isSystemAdmin: true },
    });
  });

  it('bật khi đã là Quản trị hệ thống: không ghi cờ lại, flagChanged=false', async () => {
    const t = mockTx({ isSystemAdmin: true, memberships: [m('w1', ['rAdmin'])] });
    const res = await sync.setAdmin(asTx(t), 'u1', true);
    expect(res.flagChanged).toBe(false);
    expect(t.user.update).not.toHaveBeenCalled();
  });

  it('tắt: chặn người Quản trị cuối cùng (422) TRƯỚC khi đổi gì', async () => {
    const t = mockTx({ isSystemAdmin: true, admins: ['u1'], memberships: [m('w1', ['rAdmin'])] });
    await expect(sync.setAdmin(asTx(t), 'u1', false)).rejects.toMatchObject({ status: 422 });
    expect(t.organizationMembershipRole.deleteMany).not.toHaveBeenCalled();
    expect(t.user.update).not.toHaveBeenCalled();
  });

  it('tắt: ở mỗi tổ chức đang là Quản trị → bỏ vai trò quản trị, về Organization Member (giữ vai trò thường khác), tắt cờ', async () => {
    const roleRow = (roleId: string, admin: boolean) => ({
      roleId,
      role: { permissions: admin ? [{ permission: { key: 'organization:admin' } }] : [] },
    });
    const t = mockTx({
      isSystemAdmin: true,
      admins: ['u1', 'u2'],
      memberships: [
        {
          id: 'm-w1',
          organizationId: 'w1',
          roles: [roleRow('rAdmin', true)],
        },
        {
          id: 'm-w2',
          organizationId: 'w2',
          roles: [roleRow('rAdmin', true), roleRow('rDev', false)],
        },
      ],
    });
    const res = await sync.setAdmin(asTx(t), 'u1', false);
    expect(res).toEqual({ organizationIds: ['w1', 'w2'], flagChanged: true });
    const created = t.organizationMembershipRole.createMany.mock.calls as unknown as [
      { data: { membershipId: string; roleId: string }[] },
    ][];
    expect(created[0]![0].data).toEqual([{ membershipId: 'm-w1', roleId: 'rMember' }]);
    expect(created[1]![0].data).toEqual([{ membershipId: 'm-w2', roleId: 'rDev' }]);
    expect(t.organizationMembership.update).toHaveBeenCalledWith({
      where: { id: 'm-w1' },
      data: { roleId: 'rMember' },
    });
    expect(t.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isSystemAdmin: false },
    });
  });

  it('tắt khi chưa phải Quản trị hệ thống: không chặn, không ghi cờ', async () => {
    const t = mockTx({ isSystemAdmin: false, memberships: [] });
    const res = await sync.setAdmin(asTx(t), 'u1', false);
    expect(res).toEqual({ organizationIds: [], flagChanged: false });
    expect(t.$queryRaw).not.toHaveBeenCalled();
    expect(t.user.update).not.toHaveBeenCalled();
  });

  it('người không tồn tại → 404', async () => {
    await expect(
      sync.setAdmin(asTx(mockTx({ userMissing: true })), 'x', true),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
