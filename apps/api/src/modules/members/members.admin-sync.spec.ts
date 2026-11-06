import { describe, expect, it, vi } from 'vitest';
import { MembersService } from './members.service';

/**
 * Một vai trò "Quản trị": MembersService phải đồng bộ cờ isSystemAdmin (qua AdminSyncService) mỗi khi vai trò tổ chức vào/ra
 * Quản trị — cùng transaction với thay đổi vai trò. Logic đọc/ghi của `AdminSyncService` kiểm ở `admin-sync.spec.ts`; ở đây kiểm
 * ĐIỀU PHỐI: gọi đúng lúc, đúng tham số, trong transaction, phát access.changed khi cờ đổi.
 */
const isAdminId = (id: string) => id.startsWith('admin');

const memberRow = {
  id: 'm2',
  joinedAt: new Date(),
  roleId: 'member',
  role: { id: 'member', name: 'Organization Member', color: null },
  user: {
    id: 'u2',
    email: 'ba@x.vn',
    displayName: 'Bình',
    avatarUrl: null,
    timezone: 'UTC',
    locale: 'vi',
    status: 'ACTIVE',
    isSystemAdmin: false,
    lastSeenAt: null,
    createdAt: new Date(),
  },
  roles: [{ role: { id: 'member', name: 'Organization Member', color: null } }],
};

function setup(opts: { current?: string[]; flagChanged?: boolean } = {}) {
  const current = opts.current ?? ['member'];
  const tx = {
    organizationMembership: {
      create: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findMany: vi.fn((a: { where: { roles?: unknown } }) =>
        Promise.resolve(a.where.roles ? [{ id: 'm9' }] : []),
      ),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    organizationMembershipRole: {
      deleteMany: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({})),
    },
    projectMembership: { deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    projectSubTeamMember: {
      findMany: vi.fn(() => Promise.resolve([])),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    user: {
      create: vi.fn(() => Promise.resolve({ id: 'newU' })),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    $executeRaw: vi.fn(() => Promise.resolve(0)),
  };
  const prisma = {
    user: {
      findUnique: vi.fn((a: { where: { email?: string } }) =>
        Promise.resolve(
          a.where.email
            ? null
            : { id: 'u2', displayName: 'Bình', email: 'ba@x.vn', status: 'ACTIVE' },
        ),
      ),
      findMany: vi.fn(() => Promise.resolve([{ id: 'u2', status: 'ACTIVE', email: 'ba@x.vn' }])),
    },
    role: {
      findMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(a.where.id.in.map((id) => ({ id }))),
      ),
      count: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(a.where.id.in.some(isAdminId) ? 1 : 0),
      ),
    },
    organization: { findUnique: vi.fn(() => Promise.resolve({ ownerId: 'owner' })) },
    project: { findMany: vi.fn(() => Promise.resolve([] as unknown[])) },
    organizationMembership: {
      count: vi.fn(() => Promise.resolve(1)), // còn quản trị khác
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: 'm2',
          roleId: current[0],
          roles: current.map((roleId) => ({ roleId })),
        }),
      ),
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(memberRow)),
      update: vi.fn(() => Promise.resolve({})),
    },
    organizationMembershipRole: {
      deleteMany: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({})),
    },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? Promise.resolve((arg as (t: object) => unknown)(tx))
        : Promise.resolve([]),
    ),
  };
  const adminSync = {
    grantsAdmin: vi.fn((_db: unknown, ids: readonly string[]) =>
      Promise.resolve(ids.some(isAdminId)),
    ),
    syncOnOrgRoles: vi.fn((..._a: unknown[]) => Promise.resolve(opts.flagChanged ?? true)),
  };
  const events = { emit: vi.fn() };
  const rbac = {
    invalidate: vi.fn(() => Promise.resolve()),
    invalidateOrganization: vi.fn(() => Promise.resolve()),
    holdsOrganizationAdmin: vi.fn(() => Promise.resolve(true)),
  };
  const svc = new MembersService(
    prisma as never,
    rbac as never,
    { revokeAllForUser: vi.fn(() => Promise.resolve([])), dropCaches: vi.fn() } as never,
    events as never,
    { record: vi.fn() } as never,
    adminSync as never,
  );
  return { svc, prisma, tx, adminSync, events };
}

const flagEvents = (events: { emit: ReturnType<typeof vi.fn> }) =>
  events.emit.mock.calls.filter(
    (c) => c[0] === 'access.changed' && !(c[1] as { organizationId?: string }).organizationId,
  );

describe('addOrganization', () => {
  it('thêm với vai trò Quản trị: tạo membership + đồng bộ cờ (false→true) trong CÙNG transaction, phát access.changed', async () => {
    const { svc, prisma, tx, adminSync, events } = setup();
    prisma.organizationMembership.findUnique.mockResolvedValue(null as never);
    await svc.addOrganization('w1', 'u2', ['admin1']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.organizationMembership.create).toHaveBeenCalledTimes(1);
    expect(prisma.organizationMembership.create).not.toHaveBeenCalled();
    expect(adminSync.syncOnOrgRoles).toHaveBeenCalledWith(tx, 'u2', 'w1', false, true);
    expect(flagEvents(events)).toEqual([['access.changed', { userIds: ['u2'] }]]);
  });

  it('cờ đã đúng (đã là Quản trị hệ thống) → không phát sự kiện', async () => {
    const { svc, prisma, events } = setup({ flagChanged: false });
    prisma.organizationMembership.findUnique.mockResolvedValue(null as never);
    await svc.addOrganization('w1', 'u2', ['admin1']);
    expect(flagEvents(events)).toHaveLength(0);
  });

  it('thêm với vai trò thường: ghi thẳng, KHÔNG transaction, KHÔNG đồng bộ', async () => {
    const { svc, prisma, adminSync } = setup();
    prisma.organizationMembership.findUnique.mockResolvedValue(null as never);
    await svc.addOrganization('w1', 'u2', ['member']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.organizationMembership.create).toHaveBeenCalledTimes(1);
    expect(adminSync.syncOnOrgRoles).not.toHaveBeenCalled();
  });
});

describe('setOrganizationRoles', () => {
  it('thường → Quản trị: đồng bộ (false→true) trong transaction', async () => {
    const { svc, tx, adminSync, events } = setup({ current: ['member'] });
    await svc.setOrganizationRoles('w1', 'u2', ['admin1']);
    expect(adminSync.syncOnOrgRoles).toHaveBeenCalledWith(tx, 'u2', 'w1', false, true);
    expect(flagEvents(events)).toHaveLength(1);
  });

  it('Quản trị → thường: đồng bộ (true→false); lỗi "Quản trị cuối cùng" từ đồng bộ làm hỏng cả thao tác, không phát sự kiện', async () => {
    const { svc, adminSync, events, tx } = setup({ current: ['admin1'] });
    await svc.setOrganizationRoles('w1', 'u2', ['member']);
    expect(adminSync.syncOnOrgRoles).toHaveBeenCalledWith(tx, 'u2', 'w1', true, false);

    const bad = setup({ current: ['admin1'] });
    bad.adminSync.syncOnOrgRoles.mockRejectedValue(
      Object.assign(new Error('Đây là người Quản trị cuối cùng'), { status: 422 }),
    );
    await expect(bad.svc.setOrganizationRoles('w1', 'u2', ['member'])).rejects.toMatchObject({
      status: 422,
    });
    expect(flagEvents(bad.events)).toHaveLength(0);
    expect(bad.events.emit).not.toHaveBeenCalledWith('access.changed', expect.anything());
    void events;
  });

  it('Quản trị → Quản trị (đổi bộ vai trò nhưng vẫn quản trị) và thường → thường: KHÔNG đồng bộ, dùng transaction dạng mảng cũ', async () => {
    for (const [cur, next] of [
      [['admin1'], ['admin1', 'member']],
      [['member'], ['dev']],
    ] as const) {
      const { svc, adminSync, prisma } = setup({ current: [...cur] });
      await svc.setOrganizationRoles('w1', 'u2', [...next]);
      expect(adminSync.syncOnOrgRoles).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
    }
  });
});

describe('removeOrganization / createAccount / addOrganizationMany', () => {
  it('gỡ một Quản trị khỏi tổ chức: đồng bộ (true→false) trong transaction gỡ', async () => {
    const { svc, tx, adminSync, events } = setup({ current: ['admin1'] });
    await svc.removeOrganization('w1', 'u2', 'actor');
    expect(adminSync.syncOnOrgRoles).toHaveBeenCalledWith(tx, 'u2', 'w1', true, false);
    expect(flagEvents(events)).toHaveLength(1);
  });

  it('gỡ người thường: gọi đồng bộ với (false→false) — không đổi cờ', async () => {
    const { svc, tx, adminSync } = setup({ current: ['member'], flagChanged: false });
    await svc.removeOrganization('w1', 'u2', 'actor');
    expect(adminSync.syncOnOrgRoles).toHaveBeenCalledWith(tx, 'u2', 'w1', false, false);
  });

  it('tạo tài khoản với vai trò Quản trị: đồng bộ (false→true) cho user vừa tạo trong transaction', async () => {
    const { svc, tx, adminSync } = setup();
    await svc.createAccount('w1', 'actor', {
      email: 'new@x.vn',
      displayName: 'Mới',
      roleIds: ['admin1'],
    });
    expect(adminSync.syncOnOrgRoles).toHaveBeenCalledWith(tx, 'newU', 'w1', false, true);
  });

  it('tạo tài khoản với vai trò thường: không đồng bộ', async () => {
    const { svc, adminSync } = setup();
    await svc.createAccount('w1', 'actor', {
      email: 'new@x.vn',
      displayName: 'Mới',
      roleIds: ['member'],
    });
    expect(adminSync.syncOnOrgRoles).not.toHaveBeenCalled();
  });

  it('thêm hàng loạt với vai trò Quản trị: đặt isSystemAdmin cho những người VỪA được thêm (trong transaction), phát access.changed', async () => {
    const { svc, tx, events } = setup();
    await svc.addOrganizationMany('w1', ['u2'], ['admin1']);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['u2'] }, isSystemAdmin: false },
      data: { isSystemAdmin: true },
    });
    expect(flagEvents(events)).toEqual([['access.changed', { userIds: ['u2'] }]]);
  });

  it('thêm hàng loạt với vai trò thường: không đụng cờ', async () => {
    const { svc, tx } = setup();
    await svc.addOrganizationMany('w1', ['u2'], ['member']);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});
