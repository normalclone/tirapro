import { describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service';

const ACTIVE_USER = { status: 'ACTIVE', email: 'u@x.vn' };
const ACCESS = {
  visibleWhere: vi.fn(() => Promise.resolve({})),
  onVisibilityChanged: vi.fn(() => Promise.resolve()),
  onMembersChanged: vi.fn((_w: string, _u: unknown[]) => Promise.resolve()),
};
const AUDIT = { record: vi.fn((_e?: unknown, _tx?: unknown) => Promise.resolve()) };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  workspaceId: 'w1',
  key: 'DEMO',
  name: 'Demo',
  description: null,
  type: 'SCRUM',
  leadId: null,
  avatarUrl: null,
  defaultAssigneeMode: 'UNASSIGNED',
  isArchived: false,
  archivedAt: null,
  isPrivate: false,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  _count: { issues: 0 },
  lead: null,
  ...over,
});

function make(
  over: {
    dupName?: boolean;
    member?: boolean;
    archivedCount?: number;
    cur?: Record<string, unknown> | null;
  } = {},
) {
  const prisma = {
    project: {
      findFirst: vi.fn((args: { where: { name?: string; id?: unknown } }) => {
        if (args.where.name !== undefined)
          return Promise.resolve(over.dupName ? { id: 'other' } : null);
        return Promise.resolve(over.cur === null ? null : (over.cur ?? row()));
      }),
      findMany: vi.fn((_args: { where: Record<string, unknown> }) => Promise.resolve([row()])),
      update: vi.fn(() => Promise.resolve({ id: 'p1' })),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: over.archivedCount ?? 1 }),
      ),
    },
    workspaceMembership: {
      findUnique: vi.fn(() =>
        Promise.resolve(over.member === false ? null : { id: 'm1', user: ACTIVE_USER }),
      ),
    },
  };
  const health = {
    forProjects: vi.fn((_w: string, ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, { level: 'RED', auto: {}, override: {} }]))),
    ),
  };
  return {
    service: new ProjectsService(
      prisma as never,
      {} as never,
      health as never,
      ACCESS as never,
      AUDIT as never,
    ),
    prisma,
    health,
  };
}

describe('ProjectsService — lưu trữ / sửa / xoá', () => {
  it('list(): mặc định ẩn dự án đã lưu trữ, includeArchived=true thì hiện', async () => {
    const { service, prisma } = make();
    await service.list('w1', false, 'u1');
    expect(prisma.project.findMany.mock.calls[0]![0].where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      archivedAt: null,
    });
    await service.list('w1', true, 'u1');
    expect(prisma.project.findMany.mock.calls[1]![0].where).not.toHaveProperty('archivedAt');
  });

  it('archive(): ghi archivedAt + isArchived có điều kiện chưa lưu trữ; đã lưu trữ rồi => lỗi', async () => {
    const { service, prisma } = make();
    await service.archive('w1', 'p1', 'u1');
    const call = prisma.project.updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: 'p1', archivedAt: null });
    expect(call.data).toMatchObject({ isArchived: true, updatedById: 'u1' });
    expect(call.data.archivedAt).toBeInstanceOf(Date);

    const again = make({ archivedCount: 0 });
    await expect(again.service.archive('w1', 'p1', 'u1')).rejects.toMatchObject({ status: 422 });
  });

  it('unarchive(): xoá archivedAt + isArchived', async () => {
    const { service, prisma } = make();
    await service.unarchive('w1', 'p1', 'u1');
    expect(prisma.project.updateMany.mock.calls[0]![0].data).toMatchObject({
      archivedAt: null,
      isArchived: false,
    });
  });

  it('dự án không tồn tại => 404', async () => {
    const { service } = make({ cur: null });
    await expect(service.archive('w1', 'zzz', 'u1')).rejects.toMatchObject({ status: 404 });
    await expect(service.remove('w1', 'zzz', 'u1')).rejects.toMatchObject({ status: 404 });
  });

  it('remove(): xoá mềm (deletedAt)', async () => {
    const { service, prisma } = make();
    await expect(service.remove('w1', 'p1', 'u1')).resolves.toEqual({ success: true });
    expect(prisma.project.updateMany.mock.calls[0]![0].data.deletedAt).toBeInstanceOf(Date);
  });

  it('update(): tên trùng dự án khác => lỗi; người phụ trách không phải thành viên => lỗi', async () => {
    await expect(
      make({ dupName: true }).service.update('w1', 'p1', 'u1', { name: 'Trùng' }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      make({ member: false }).service.update('w1', 'p1', 'u1', { leadId: 'ngoài' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('update(): chỉ ghi các trường được gửi', async () => {
    const { service, prisma } = make();
    await service.update('w1', 'p1', 'u1', {
      description: 'Mô tả mới',
      defaultAssigneeMode: 'PROJECT_LEAD',
    });
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: { updatedById: 'u1', description: 'Mô tả mới', defaultAssigneeMode: 'PROJECT_LEAD' },
      }),
    );
  });
});

describe('ProjectsService — dự án lưu trữ là chỉ đọc (cài đặt chung)', () => {
  const archivedRow = () => row({ archivedAt: new Date('2026-10-10T00:00:00Z'), isArchived: true });

  it('update() trên dự án đã lưu trữ => 422 PROJECT_ARCHIVED_MESSAGE, không ghi', async () => {
    const { service, prisma } = make({ cur: archivedRow() });
    await expect(
      service.update('w1', 'p1', 'u1', { description: 'Mô tả mới' }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('lưu trữ') as unknown,
    });
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('unarchive()/remove() KHÔNG bị chặn (vòng đời dự án)', async () => {
    const { service, prisma } = make({ cur: archivedRow() });
    await service.unarchive('w1', 'p1', 'u1');
    await service.remove('w1', 'p1', 'u1');
    expect(prisma.project.updateMany).toHaveBeenCalledTimes(2);
  });

  it('setAvatar()/clearAvatar() trên dự án đã lưu trữ => 422, không lưu tệp, không ghi', async () => {
    const media = { saveAvatar: vi.fn(() => Promise.resolve('/u/a.png')), removeByUrl: vi.fn() };
    const prisma = {
      project: {
        findFirst: vi.fn(() =>
          Promise.resolve({ id: 'p1', avatarUrl: null, archivedAt: new Date() }),
        ),
        update: vi.fn(() => Promise.resolve({})),
      },
    };
    const service = new ProjectsService(
      prisma as never,
      media as never,
      {} as never,
      ACCESS as never,
      AUDIT as never,
    );
    await expect(service.setAvatar('w1', 'DEMO', undefined, {} as never)).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.clearAvatar('w1', 'DEMO')).rejects.toMatchObject({ status: 422 });
    expect(media.saveAvatar).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.meta — severities + resolutions', () => {
  it('trả danh mục Severity (rank giảm) và Resolution (rank tăng) của workspace', async () => {
    const sev = [
      { id: 's1', name: 'Critical', description: null, color: '#f00', rank: 4, isDefault: false },
    ];
    const res = [{ id: 'r1', name: 'Fixed', description: null, rank: 1, isDefault: true }];
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1', key: 'DEMO' })) },
      issueType: { findMany: vi.fn(() => Promise.resolve([])) },
      priority: { findMany: vi.fn(() => Promise.resolve([])) },
      severity: { findMany: vi.fn(() => Promise.resolve(sev)) },
      resolution: { findMany: vi.fn(() => Promise.resolve(res)) },
    };
    const service = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      ACCESS as never,
      AUDIT as never,
    );
    const out = await service.meta('w1', 'DEMO');
    expect(out).toMatchObject({ projectId: 'p1', severities: sev, resolutions: res });
    expect(prisma.severity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1' }, orderBy: { rank: 'desc' } }),
    );
    expect(prisma.resolution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1' }, orderBy: { rank: 'asc' } }),
    );
  });
});

describe('ProjectsService.setHealth — ghi đè sức khoẻ dự án', () => {
  const lastUpdate = (prisma: ReturnType<typeof make>['prisma']) =>
    (
      prisma.project.update.mock.calls[0] as unknown as [
        { where: { id: string }; data: Record<string, unknown> },
      ]
    )[0];

  it('đặt mức + ghi chú: lưu healthOverride/healthNote/healthUpdatedAt/healthUpdatedById và trả sức khoẻ hiệu lực', async () => {
    const { service, prisma, health } = make();
    const dto = await service.setHealth('w1', 'p1', 'u1', {
      health: 'RED',
      note: '  Khách đổi phạm vi giữa chừng  ',
    });
    const call = lastUpdate(prisma);
    expect(call.where).toEqual({ id: 'p1' });
    expect(call.data).toMatchObject({
      healthOverride: 'RED',
      healthNote: 'Khách đổi phạm vi giữa chừng',
      healthUpdatedById: 'u1',
    });
    expect(call.data.healthUpdatedAt).toBeInstanceOf(Date);
    expect(health.forProjects).toHaveBeenCalledWith('w1', ['p1'], null);
    expect(dto).toMatchObject({ level: 'RED' });
  });

  it('đặt mức mà không có ghi chú (hoặc chỉ khoảng trắng) => lỗi nghiệp vụ, không ghi', async () => {
    const { service, prisma } = make();
    await expect(service.setHealth('w1', 'p1', 'u1', { health: 'RED' })).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('ghi chú') as unknown,
    });
    await expect(
      service.setHealth('w1', 'p1', 'u1', { health: 'YELLOW', note: '   ' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('health: null => bỏ ghi đè, xoá cả ghi chú/người đặt/thời điểm (không cần ghi chú)', async () => {
    const { service, prisma } = make();
    await service.setHealth('w1', 'p1', 'u1', { health: null, note: 'bỏ qua' });
    expect(lastUpdate(prisma).data).toEqual({
      healthOverride: null,
      healthNote: null,
      healthUpdatedAt: null,
      healthUpdatedById: null,
    });
  });

  it('dự án đã lưu trữ => 422 "lưu trữ", không ghi; dự án không tồn tại => 404', async () => {
    const archived = make({
      cur: row({ archivedAt: new Date('2026-10-10T00:00:00Z'), isArchived: true }),
    });
    await expect(
      archived.service.setHealth('w1', 'p1', 'u1', { health: 'GREEN', note: 'ok' }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('lưu trữ') as unknown,
    });
    expect(archived.prisma.project.update).not.toHaveBeenCalled();

    const missing = make({ cur: null });
    await expect(
      missing.service.setHealth('w1', 'p1', 'u1', { health: null }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('ProjectsService.create — vai trò chủ dự án', () => {
  it('membership của người tạo có dòng nối ProjectMembershipRole (Quản trị dự án)', async () => {
    const ok = () => vi.fn(() => Promise.resolve({ id: 'x' }));
    const tx = {
      project: {
        create: vi.fn(() => Promise.resolve(row({ id: 'p1', name: 'D' }))),
        update: ok(),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
    };
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const svc = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      ACCESS as never,
      AUDIT as never,
    );
    await svc.create('w1', 'u1', { key: 'D', name: 'D', type: 'SCRUM' } as never);
    const arg = tx.projectMembership.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(arg[0].data).toMatchObject({
      projectId: 'p1',
      userId: 'u1',
      roleId: 'r-padmin',
      roles: { create: [{ roleId: 'r-padmin' }] },
    });
  });
});

describe('ProjectsService.create — mẫu dự án', () => {
  function makeTx() {
    const ok = () => vi.fn((_a?: unknown) => Promise.resolve({ id: 'x' }));
    const tx = {
      project: {
        create: vi.fn((_a?: unknown) => Promise.resolve(row({ id: 'p1', name: 'D' }))),
        update: ok(),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
    };
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    return {
      tx,
      svc: new ProjectsService(
        prisma as never,
        {} as never,
        {} as never,
        ACCESS as never,
        AUDIT as never,
      ),
    };
  }
  const arg = (m: { mock: { calls: unknown[][] } }, i = 0) =>
    (m.mock.calls[i] as unknown as [{ data: Record<string, unknown> }])[0].data;

  it('templateKey thắng type: requirements + type SCRUM => dự án/bảng KANBAN, quy trình 6 trạng thái/6 cột', async () => {
    const { tx, svc } = makeTx();
    await svc.create('w1', 'u1', {
      key: 'YCKA',
      name: 'Yêu cầu khách A',
      type: 'SCRUM',
      templateKey: 'requirements',
    });
    expect(arg(tx.project.create).type).toBe('KANBAN');
    expect(String(arg(tx.workflow.create).name)).toContain('Quản lý yêu cầu');
    expect(tx.status.create).toHaveBeenCalledTimes(6);
    expect(arg(tx.board.create).type).toBe('KANBAN');
    expect(tx.boardColumn.create).toHaveBeenCalledTimes(6);
    expect(tx.workflowTransition.create).toHaveBeenCalledTimes(9);
  });

  it('không templateKey: type KANBAN => "Kanban mặc định" (hành vi cũ)', async () => {
    const { tx, svc } = makeTx();
    await svc.create('w1', 'u1', { key: 'KB', name: 'KB', type: 'KANBAN' });
    expect(String(arg(tx.workflow.create).name)).toContain('Kanban mặc định');
    expect(tx.status.create).toHaveBeenCalledTimes(3);
    expect(arg(tx.project.create).type).toBe('KANBAN');
  });

  it('templateKey scrum => SCRUM, 4 trạng thái', async () => {
    const { tx, svc } = makeTx();
    await svc.create('w1', 'u1', { key: 'SC', name: 'SC', type: 'KANBAN', templateKey: 'scrum' });
    expect(arg(tx.project.create).type).toBe('SCRUM');
    expect(tx.status.create).toHaveBeenCalledTimes(4);
    expect(arg(tx.board.create).type).toBe('SCRUM');
  });

  it('tên quy trình của dự án có hậu tố mã dự án để không trùng nhau', async () => {
    const { tx, svc } = makeTx();
    await svc.create('w1', 'u1', { key: 'DEMO', name: 'Demo', type: 'SCRUM' });
    expect(arg(tx.workflow.create).name).toBe('Scrum mặc định (DEMO)');
  });
});

describe('ProjectsService — dự án riêng tư', () => {
  it('list(viewerId): where chứa điều kiện hiển thị của ProjectAccessService (công khai hoặc là thành viên)', async () => {
    const visible = {
      OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }],
    };
    const { service, prisma } = make();
    ACCESS.visibleWhere.mockResolvedValueOnce(visible);
    await service.list('w1', false, 'u1');
    expect(ACCESS.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(prisma.project.findMany.mock.calls.at(-1)![0].where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      archivedAt: null,
      ...visible,
    });
  });

  it('create: isPrivate được ghi (mặc định false) và có trong DTO', async () => {
    const ok = () => vi.fn((_a?: unknown) => Promise.resolve({ id: 'x' }));
    const tx = {
      project: {
        create: vi.fn((_a?: unknown) => Promise.resolve(row({ id: 'p1', isPrivate: true }))),
        update: ok(),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
    };
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })) },
      workspaceMembership: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'm', user: ACTIVE_USER })),
      },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const svc = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      ACCESS as never,
      AUDIT as never,
    );
    const dto = await svc.create('w1', 'u1', {
      key: 'HR',
      name: 'Nhân sự',
      type: 'SCRUM',
      isPrivate: true,
    });
    const data = (
      tx.project.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.isPrivate).toBe(true);
    expect(dto.isPrivate).toBe(true);
    // người phụ trách khác người tạo cũng phải là thành viên (dự án riêng tư không để lead mất quyền xem)
    await svc.create('w1', 'u1', {
      key: 'HR2',
      name: 'Nhân sự 2',
      type: 'SCRUM',
      isPrivate: true,
      leadId: 'lead9',
    });
    const members = tx.projectMembership.create.mock.calls.map(
      (c) => (c[0] as { data: { userId: string } }).data.userId,
    );
    expect(members).toEqual(['u1', 'u1', 'lead9']);
  });
});

describe('ProjectsService.update — đổi riêng tư', () => {
  function setup(opts: { cur?: Record<string, unknown> } = {}) {
    const tx = {
      project: { update: vi.fn((_a?: unknown) => Promise.resolve({ id: 'p1' })) },
      projectMembership: { upsert: vi.fn((_a?: unknown) => Promise.resolve({ id: 'pm' })) },
    };
    const prisma = {
      project: {
        findFirst: vi.fn(() =>
          Promise.resolve(row({ leadId: 'lead1', isPrivate: false, ...opts.cur })),
        ),
        update: vi.fn((_a?: unknown) => Promise.resolve({ id: 'p1' })),
      },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    AUDIT.record.mockClear();
    ACCESS.onVisibilityChanged.mockClear();
    ACCESS.onMembersChanged.mockClear();
    const svc = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      ACCESS as never,
      AUDIT as never,
    );
    return { svc, prisma, tx };
  }

  it('false → true: trong transaction bảo đảm người thao tác và người phụ trách là thành viên (Project Admin), ghi nhật ký, xoá cache quyền', async () => {
    const { svc, prisma, tx } = setup();
    await svc.update('w1', 'p1', 'actor1', { isPrivate: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.project.update.mock.calls[0]![0]).toMatchObject({
      where: { id: 'p1' },
      data: { isPrivate: true },
    });
    const users = tx.projectMembership.upsert.mock.calls.map(
      (c) =>
        (c[0] as { where: { projectId_userId: { userId: string } } }).where.projectId_userId.userId,
    );
    expect(users.sort()).toEqual(['actor1', 'lead1']);
    expect(tx.projectMembership.upsert.mock.calls[0]![0]).toMatchObject({
      update: {},
      create: {
        projectId: 'p1',
        roleId: 'r-padmin',
        roles: { create: [{ roleId: 'r-padmin' }] },
      },
    });
    // nhật ký ghi CÙNG transaction (truyền tx)
    expect(AUDIT.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.visibility_changed',
        entityType: 'project',
        entityId: 'p1',
        meta: { isPrivate: true },
      }),
      tx,
    );
    expect(ACCESS.onVisibilityChanged).toHaveBeenCalledWith('w1');
  });

  it('người thao tác cũng là người phụ trách => chỉ một dòng thành viên', async () => {
    const { svc, tx } = setup({ cur: { leadId: 'actor1' } });
    await svc.update('w1', 'p1', 'actor1', { isPrivate: true });
    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
  });

  it('đổi người phụ trách cùng lúc bật riêng tư => người phụ trách MỚI được bảo đảm', async () => {
    const { svc, tx, prisma } = setup();
    (prisma as unknown as { workspaceMembership: unknown }).workspaceMembership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm', user: ACTIVE_USER })),
    };
    await svc.update('w1', 'p1', 'actor1', { isPrivate: true, leadId: 'lead2' });
    const users = tx.projectMembership.upsert.mock.calls.map(
      (c) =>
        (c[0] as { where: { projectId_userId: { userId: string } } }).where.projectId_userId.userId,
    );
    expect(users.sort()).toEqual(['actor1', 'lead2']);
  });

  it('đang riêng tư, đổi người phụ trách => người phụ trách mới được thêm làm thành viên', async () => {
    const { svc, tx, prisma } = setup({ cur: { isPrivate: true } });
    (prisma as unknown as { workspaceMembership: unknown }).workspaceMembership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm', user: ACTIVE_USER })),
    };
    await svc.update('w1', 'p1', 'actor1', { leadId: 'lead2' });
    const users = tx.projectMembership.upsert.mock.calls.map(
      (c) =>
        (c[0] as { where: { projectId_userId: { userId: string } } }).where.projectId_userId.userId,
    );
    expect(users).toEqual(['lead2']);
    expect(AUDIT.record).not.toHaveBeenCalled();
    // lead mới được xoá cache quyền để không giữ tập quyền rỗng đã cache
    expect(ACCESS.onMembersChanged).toHaveBeenCalledWith('w1', ['lead2']);
    expect(ACCESS.onVisibilityChanged).not.toHaveBeenCalled();
  });

  it('đổi lead sang tài khoản vô hiệu hoá => từ chối, không ghi', async () => {
    const { svc, tx, prisma } = setup({ cur: { isPrivate: true } });
    (prisma as unknown as { workspaceMembership: unknown }).workspaceMembership = {
      findUnique: vi.fn(() =>
        Promise.resolve({ id: 'm', user: { status: 'DEACTIVATED', email: 'a@x.vn' } }),
      ),
    };
    await expect(svc.update('w1', 'p1', 'actor1', { leadId: 'lead2' })).rejects.toMatchObject({
      status: 422,
    });
    expect(tx.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it('true → false: không xoá thành viên, ghi nhật ký "mở cho mọi thành viên"', async () => {
    const { svc, prisma, tx } = setup({ cur: { isPrivate: true } });
    await svc.update('w1', 'p1', 'actor1', { isPrivate: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.project.update.mock.calls[0]![0]).toMatchObject({ data: { isPrivate: false } });
    expect(tx.projectMembership.upsert).not.toHaveBeenCalled();
    expect(AUDIT.record.mock.calls[0]![0]).toMatchObject({
      action: 'project.visibility_changed',
      meta: { isPrivate: false },
    });
    expect(AUDIT.record.mock.calls[0]![1]).toBe(tx);
  });

  it('không đổi giá trị (đã riêng tư, gửi true) => không ghi nhật ký, không đụng thành viên', async () => {
    const { svc, tx } = setup({ cur: { isPrivate: true } });
    await svc.update('w1', 'p1', 'actor1', { isPrivate: true });
    expect(tx.projectMembership.upsert).not.toHaveBeenCalled();
    expect(AUDIT.record).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.create — điều kiện cho dự án riêng tư / người phụ trách', () => {
  function setup(opts: { adminRole?: boolean; member?: unknown } = {}) {
    // tx giả: mọi model.method đều trả một dòng dự án (đủ cho luồng tạo thành công)
    const tx = new Proxy(
      {},
      { get: () => new Proxy({}, { get: () => vi.fn(() => Promise.resolve(row())) }) },
    );
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: {
        findFirst: vi.fn(() =>
          Promise.resolve(opts.adminRole === false ? null : { id: 'r-padmin' }),
        ),
      },
      workspaceMembership: {
        findUnique: vi.fn(() =>
          Promise.resolve(opts.member === undefined ? { id: 'm', user: ACTIVE_USER } : opts.member),
        ),
      },
      $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    };
    const svc = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      ACCESS as never,
      AUDIT as never,
    );
    return { svc, prisma };
  }

  it('riêng tư mà thiếu vai trò hệ thống Project Admin => lỗi rõ, KHÔNG tạo dự án', async () => {
    const { svc, prisma } = setup({ adminRole: false });
    await expect(
      svc.create('w1', 'u1', { key: 'HR', name: 'HR', type: 'SCRUM', isPrivate: true }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Quản trị dự án') as unknown,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('leadId không phải thành viên workspace => lỗi, không tạo', async () => {
    const { svc, prisma } = setup({ member: null });
    await expect(
      svc.create('w1', 'u1', { key: 'HR', name: 'HR', type: 'SCRUM', leadId: 'ngoai' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['vô hiệu hoá', { status: 'DEACTIVATED', email: 'a@x.vn' }],
    ['tài khoản hệ thống', { status: 'ACTIVE', email: 'automation@tirapro.local' }],
  ])('leadId là tài khoản %s => từ chối', async (_n, user) => {
    const { svc, prisma } = setup({ member: { id: 'm', user } });
    await expect(
      svc.create('w1', 'u1', { key: 'HR', name: 'HR', type: 'SCRUM', leadId: 'x' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('công khai không gán lead: không kiểm thành viên (hành vi cũ)', async () => {
    const { svc, prisma } = setup();
    await svc.create('w1', 'u1', { key: 'HR', name: 'HR', type: 'SCRUM' });
    expect(prisma.workspaceMembership.findUnique).not.toHaveBeenCalled();
  });
});
