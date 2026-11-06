import { describe, expect, it, vi } from 'vitest';
import { ProjectRolesService } from './project-roles.service';

const ROLE_ROW = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  organizationId: 'w1',
  projectId: 'p1',
  name: 'Tester',
  description: null,
  color: null,
  updatedAt: new Date('2026-11-09T00:00:00Z'),
  permissions: [{ permission: { key: 'issue:create' } }],
  _count: { projMembershipRoles: 0 },
  ...over,
});

function setup(
  opts: {
    template?: unknown;
    dup?: unknown;
    own?: unknown;
    created?: Record<string, unknown>;
  } = {},
) {
  const tx = {
    rolePermission: { deleteMany: vi.fn(() => Promise.resolve({})) },
    role: {
      update: vi.fn((a: { data: { name?: string } }) =>
        Promise.resolve(ROLE_ROW({ name: a.data.name ?? 'Tester' })),
      ),
    },
  };
  const prisma = {
    role: {
      findMany: vi.fn(() => Promise.resolve([ROLE_ROW()])),
      findFirst: vi.fn((a: { where: { id?: unknown; projectId?: unknown; name?: unknown } }) => {
        if (a.where.name) return Promise.resolve(opts.dup ?? null); // kiểm trùng tên
        if (a.where.projectId === null) return Promise.resolve(opts.template ?? null); // mẫu
        return Promise.resolve(
          opts.own === undefined
            ? { id: 'r1', name: 'Tester', _count: { projMembershipRoles: 0 } }
            : opts.own,
        );
      }),
      create: vi.fn((a: { data: { name: string } }) =>
        Promise.resolve(ROLE_ROW({ name: a.data.name, ...opts.created })),
      ),
      delete: vi.fn(() => Promise.resolve({})),
    },
    permission: {
      findMany: vi.fn((a: { where: { key: { in: string[] } } }) =>
        Promise.resolve(a.where.key.in.map((k) => ({ id: `id:${k}` }))),
      ),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  const rbac = { invalidateOrganization: vi.fn(() => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const events = { emit: vi.fn() };
  const svc = new ProjectRolesService(
    prisma as never,
    rbac as never,
    audit as never,
    events as never,
  );
  return { svc, prisma, tx, rbac, audit, events };
}

describe('ProjectRolesService.list', () => {
  it('chỉ vai trò RIÊNG của dự án (tổ chức + projectId + cấp DỰ ÁN), kèm quyền và số người dùng', async () => {
    const { svc, prisma } = setup();
    const out = await svc.list('w1', 'p1');
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'w1', projectId: 'p1', scope: 'PROJECT' },
      }),
    );
    expect(out).toEqual([
      expect.objectContaining({
        id: 'r1',
        projectId: 'p1',
        permissionKeys: ['issue:create'],
        memberCount: 0,
      }),
    ]);
  });
});

describe('create', () => {
  it('tự chọn quyền: tạo với projectId, scope PROJECT, quyền cấp dự án; ghi nhật ký', async () => {
    const { svc, prisma, audit } = setup();
    const r = await svc.create(
      'w1',
      'p1',
      { name: ' Tester ', permissionKeys: ['issue:create', 'issue:create', 'project:view'] },
      'u1',
    );
    const data = prisma.role.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      organizationId: 'w1',
      projectId: 'p1',
      name: 'Tester',
      scope: 'PROJECT',
      isSystem: false,
    });
    expect(prisma.permission.findMany).toHaveBeenCalledWith({
      where: { key: { in: ['issue:create', 'project:view'] } },
      select: { id: true },
    });
    expect(r.projectId).toBe('p1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.created', actorId: 'u1' }),
    );
  });

  it('Project Admin được cấp BẤT KỲ quyền cấp dự án, kể cả project:admin (quyết định: không thêm giới hạn)', async () => {
    const { svc } = setup();
    await expect(
      svc.create(
        'w1',
        'p1',
        { name: 'PM phụ', permissionKeys: ['project:admin', 'sprint:manage'] },
        'u1',
      ),
    ).resolves.toBeDefined();
  });

  it('quyền cấp TỔ CHỨC hoặc không có trong catalog → 422, không tạo', async () => {
    const { svc, prisma } = setup();
    await expect(
      svc.create('w1', 'p1', { name: 'X', permissionKeys: ['organization:admin'] }, 'u1'),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      svc.create('w1', 'p1', { name: 'X', permissionKeys: ['member:manage', 'bogus:key'] }, 'u1'),
    ).rejects.toThrow(/member:manage, bogus:key/);
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('từ mẫu: sao chép tên + mô tả + quyền CẤP DỰ ÁN của mẫu (bỏ quyền tổ chức); đổi tên được', async () => {
    const template = {
      name: 'Developer',
      description: 'Lập trình',
      color: '#abc',
      permissions: [
        { permission: { key: 'issue:create' } },
        { permission: { key: 'organization:view' } },
      ],
    };
    const a = setup({ template });
    await a.svc.create('w1', 'p1', { fromTemplateId: 't1' }, 'u1');
    const first = a.prisma.role.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(first).toMatchObject({
      name: 'Developer',
      description: 'Lập trình',
      color: '#abc',
      projectId: 'p1',
    });
    expect(a.prisma.permission.findMany).toHaveBeenCalledWith({
      where: { key: { in: ['issue:create'] } },
      select: { id: true },
    });
    const b = setup({ template });
    await b.svc.create('w1', 'p1', { fromTemplateId: 't1', name: 'Dev nhóm A' }, 'u1');
    expect(b.prisma.role.create.mock.calls[0]![0].data.name).toBe('Dev nhóm A');
    // mẫu phải là mẫu cấp dự án dùng chung của tổ chức này (projectId null)
    expect(a.prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 't1', scope: 'PROJECT', projectId: null }) as object,
      }),
    );
  });

  it('mẫu không tồn tại (hoặc là vai trò của dự án khác) → 404', async () => {
    const { svc } = setup({ template: null });
    await expect(svc.create('w1', 'p1', { fromTemplateId: 'nope' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('tên trùng trong dự án (không phân biệt hoa thường) → 422', async () => {
    const { svc, prisma } = setup({ dup: { id: 'x' } });
    await expect(
      svc.create('w1', 'p1', { name: 'tester', permissionKeys: [] }, 'u1'),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'p1',
          name: { equals: 'tester', mode: 'insensitive' },
        }) as object,
      }),
    );
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('không tên và không mẫu → 422', async () => {
    const { svc } = setup();
    await expect(svc.create('w1', 'p1', {}, 'u1')).rejects.toMatchObject({ status: 422 });
  });
});

describe('update', () => {
  it('chỉ sửa được vai trò RIÊNG của đúng dự án (mẫu / vai trò dự án khác → 404)', async () => {
    const { svc, prisma } = setup({ own: null });
    await expect(svc.update('w1', 'p1', 'rX', { name: 'A' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rX', organizationId: 'w1', projectId: 'p1', scope: 'PROJECT' },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('đổi quyền: thay bộ quyền trong transaction, xoá cache quyền cả tổ chức, phát access.changed, ghi nhật ký', async () => {
    const { svc, tx, rbac, events, audit } = setup();
    await svc.update('w1', 'p1', 'r1', { permissionKeys: ['issue:edit'] }, 'u1');
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r1' } });
    expect(rbac.invalidateOrganization).toHaveBeenCalledWith('w1');
    expect(events.emit).toHaveBeenCalledWith('access.changed', { organizationId: 'w1' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.updated' }));
  });

  it('quyền cấp tổ chức → 422; đổi tên trùng role khác → 422 (không tính chính nó)', async () => {
    const a = setup();
    await expect(
      a.svc.update('w1', 'p1', 'r1', { permissionKeys: ['organization:admin'] }, 'u1'),
    ).rejects.toMatchObject({ status: 422 });
    const b = setup({ dup: { id: 'other' } });
    await expect(b.svc.update('w1', 'p1', 'r1', { name: 'Dev' }, 'u1')).rejects.toMatchObject({
      status: 422,
    });
    expect(b.prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'r1' } }) as object }),
    );
  });

  it('chỉ đổi tên/mô tả → không động tới quyền, không phát access.changed', async () => {
    const { svc, tx, events } = setup();
    await svc.update('w1', 'p1', 'r1', { description: 'mô tả' }, 'u1');
    expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('đang được gán → 422 kèm SỐ người đang dùng, không xoá', async () => {
    const { svc, prisma } = setup({
      own: { id: 'r1', name: 'Tester', _count: { projMembershipRoles: 3 } },
    });
    await expect(svc.remove('w1', 'p1', 'r1', 'u1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('3 người') as string,
    });
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('chưa ai dùng → xoá, xoá cache, ghi nhật ký; vai trò khác dự án → 404', async () => {
    const { svc, prisma, rbac, audit } = setup();
    expect(await svc.remove('w1', 'p1', 'r1', 'u1')).toEqual({ success: true });
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(rbac.invalidateOrganization).toHaveBeenCalledWith('w1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.deleted' }));
    const other = setup({ own: null });
    await expect(other.svc.remove('w1', 'p1', 'rZ', 'u1')).rejects.toMatchObject({ status: 404 });
  });
});
