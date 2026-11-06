import { describe, expect, it, vi } from 'vitest';
import { hasTriageVisible } from '../../common/triage-visibility.testutil';
import { ProjectsService } from './projects.service';

/** Bảng mà WorkflowResolver đọc khi tạo dự án (không có loại việc → không gì để đồng bộ vào bảng). */
const resolverTables = () => ({
  projectWorkflowOverride: { findMany: vi.fn(() => Promise.resolve([])) },
  organizationWorkflowScheme: { findMany: vi.fn(() => Promise.resolve([])) },
  issueType: { findMany: vi.fn(() => Promise.resolve([])) },
});

const ACTIVE_USER = { status: 'ACTIVE', email: 'u@x.vn' };
const ACCESS = {
  visibleWhere: vi.fn(() => Promise.resolve({})),
  onVisibilityChanged: vi.fn(() => Promise.resolve()),
  onMembersChanged: vi.fn((_w: string, _u: unknown[]) => Promise.resolve()),
};
const AUDIT = { record: vi.fn((_e?: unknown, _tx?: unknown) => Promise.resolve()) };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  organizationId: 'w1',
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
    organizationMembership: {
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
      organizationId: 'w1',
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
    await expect(
      service.setAvatar('w1', 'DEMO', undefined, {} as never, 'u1'),
    ).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.clearAvatar('w1', 'DEMO', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(media.saveAvatar).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.meta — severities + resolutions', () => {
  it('trả danh mục Severity (rank giảm) và Resolution (rank tăng) của organization', async () => {
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
      expect.objectContaining({ where: { organizationId: 'w1' }, orderBy: { rank: 'desc' } }),
    );
    expect(prisma.resolution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'w1' }, orderBy: { rank: 'asc' } }),
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
        findUnique: vi.fn(() =>
          Promise.resolve({ organizationId: 'w1', defaultWorkflowId: 'wf-clone' }),
        ),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
      ...resolverTables(),
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
        findUnique: vi.fn(() =>
          Promise.resolve({ organizationId: 'w1', defaultWorkflowId: 'wf-clone' }),
        ),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
      ...resolverTables(),
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

  it('templateKey software => 9 trạng thái, 18 chuyển tiếp, 8 cột (Xong gộp 2), bảng ẩn Epic', async () => {
    const { tx, svc } = makeTx();
    await svc.create('w1', 'u1', { key: 'SW', name: 'SW', type: 'SCRUM', templateKey: 'software' });
    expect(arg(tx.project.create).type).toBe('KANBAN');
    expect(tx.status.create).toHaveBeenCalledTimes(9);
    const sts = tx.status.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(sts.filter((d) => d.isInitial).map((d) => d.name)).toEqual(['Cần làm']);
    expect(tx.workflowTransition.create).toHaveBeenCalledTimes(18);
    const trs = tx.workflowTransition.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(trs.filter((d) => d.fromStatusId === null).map((d) => d.name)).toEqual(['Không xử lý']);
    expect(arg(tx.board.create).filterJql).toBe('type != Epic');
    expect(tx.boardColumn.create).toHaveBeenCalledTimes(8);
    const cols = tx.boardColumn.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data.name,
    );
    expect(cols[7]).toBe('Xong');
    expect(tx.boardColumnStatus.create).toHaveBeenCalledTimes(9);
  });

  it('templateKey general => 5 trạng thái, 9 chuyển tiếp, 4 cột, bảng ẩn Epic', async () => {
    const { tx, svc } = makeTx();
    await svc.create('w1', 'u1', { key: 'GN', name: 'GN', type: 'SCRUM', templateKey: 'general' });
    expect(tx.status.create).toHaveBeenCalledTimes(5);
    expect(tx.workflowTransition.create).toHaveBeenCalledTimes(9);
    expect(tx.boardColumn.create).toHaveBeenCalledTimes(4);
    expect(tx.boardColumnStatus.create).toHaveBeenCalledTimes(5);
    expect(arg(tx.board.create).filterJql).toBe('type != Epic');
  });

  it('mẫu cũ: bảng không có filterJql, 1 cột / trạng thái', async () => {
    const { tx, svc } = makeTx();
    await svc.create('w1', 'u1', {
      key: 'KB',
      name: 'KB',
      type: 'KANBAN',
      templateKey: 'requirements',
    });
    expect(arg(tx.board.create)).not.toHaveProperty('filterJql');
    expect(tx.boardColumnStatus.create).toHaveBeenCalledTimes(6);
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
      organizationId: 'w1',
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
        findUnique: vi.fn(() =>
          Promise.resolve({ organizationId: 'w1', defaultWorkflowId: 'wf-clone' }),
        ),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
      ...resolverTables(),
    };
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })) },
      organizationMembership: {
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

function setupPrivacyUpdate(opts: { cur?: Record<string, unknown> } = {}) {
  const tx = {
    project: { update: vi.fn((_a?: unknown) => Promise.resolve({ id: 'p1' })) },
    projectMembership: { upsert: vi.fn((_a?: unknown) => Promise.resolve({ id: 'pm' })) },
    projectSubTeamMember: { deleteMany: vi.fn((_a?: unknown) => Promise.resolve({ count: 0 })) },
    $executeRaw: vi.fn((..._a: unknown[]) => Promise.resolve(0)),
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
  const events = { emit: vi.fn() };
  const svc = new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    ACCESS as never,
    AUDIT as never,
    events as never,
  );
  return { svc, prisma, tx, events };
}

describe('ProjectsService.update — đổi riêng tư', () => {
  it('đổi cờ riêng tư -> phát project.visibility_changed (gateway rà lại socket); không đổi thì không', async () => {
    const changed = setupPrivacyUpdate();
    await changed.svc.update('w1', 'p1', 'actor1', { isPrivate: true });
    expect(changed.events.emit).toHaveBeenCalledWith('project.visibility_changed', {
      organizationId: 'w1',
      projectId: 'p1',
      isPrivate: true, // hướng đổi: sang riêng tư mới tắt kênh Telegram gắn dự án
      actorId: 'actor1',
    });
    const same = setupPrivacyUpdate({ cur: { isPrivate: true } });
    await same.svc.update('w1', 'p1', 'actor1', { isPrivate: true });
    expect(same.events.emit).not.toHaveBeenCalled();
  });

  it('false → true: trong transaction bảo đảm người thao tác và người phụ trách là thành viên (Project Admin), ghi nhật ký, xoá cache quyền', async () => {
    const { svc, prisma, tx } = setupPrivacyUpdate();
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
    // người không có ProjectMembership ra khỏi team riêng của dự án (cùng transaction)
    expect(tx.projectSubTeamMember.deleteMany).toHaveBeenCalledWith({
      where: {
        subTeam: { projectId: 'p1' },
        user: { projectMemberships: { none: { projectId: 'p1' } } },
      },
    });
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
    const { svc, tx } = setupPrivacyUpdate({ cur: { leadId: 'actor1' } });
    await svc.update('w1', 'p1', 'actor1', { isPrivate: true });
    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
  });

  it('đổi người phụ trách cùng lúc bật riêng tư => người phụ trách MỚI được bảo đảm', async () => {
    const { svc, tx, prisma } = setupPrivacyUpdate();
    (prisma as unknown as { organizationMembership: unknown }).organizationMembership = {
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
    const { svc, tx, prisma } = setupPrivacyUpdate({ cur: { isPrivate: true } });
    (prisma as unknown as { organizationMembership: unknown }).organizationMembership = {
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
    const { svc, tx, prisma } = setupPrivacyUpdate({ cur: { isPrivate: true } });
    (prisma as unknown as { organizationMembership: unknown }).organizationMembership = {
      findUnique: vi.fn(() =>
        Promise.resolve({ id: 'm', user: { status: 'DEACTIVATED', email: 'a@x.vn' } }),
      ),
    };
    await expect(svc.update('w1', 'p1', 'actor1', { leadId: 'lead2' })).rejects.toMatchObject({
      status: 422,
    });
    expect(tx.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it('true → false (mở công khai): phát project.access_changed userIds null để thử gán lại việc Jira đang chờ', async () => {
    const { svc, events } = setupPrivacyUpdate({ cur: { isPrivate: true } });
    await svc.update('w1', 'p1', 'actor1', { isPrivate: false });
    expect(events.emit).toHaveBeenCalledWith('project.access_changed', {
      organizationId: 'w1',
      projectId: 'p1',
      userIds: null,
      actorId: 'actor1',
    });
  });

  it('đang riêng tư, người phụ trách mới vào dự án: phát project.access_changed với người đó; bật riêng tư thì không phát', async () => {
    const a = setupPrivacyUpdate({ cur: { isPrivate: true } });
    (a.prisma as unknown as { organizationMembership: unknown }).organizationMembership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm', user: ACTIVE_USER })),
    };
    await a.svc.update('w1', 'p1', 'actor1', { leadId: 'lead2' });
    expect(a.events.emit).toHaveBeenCalledWith(
      'project.access_changed',
      expect.objectContaining({ projectId: 'p1', userIds: ['lead2'] }),
    );
    const b = setupPrivacyUpdate();
    await b.svc.update('w1', 'p1', 'actor1', { isPrivate: true });
    // Bật riêng tư không phát access_changed (quyền xem hẹp đi, không rộng ra); chỉ có visibility_changed của P16.
    expect(b.events.emit).not.toHaveBeenCalledWith('project.access_changed', expect.anything());
  });

  it('true → false: không xoá thành viên, ghi nhật ký "mở cho mọi thành viên"', async () => {
    const { svc, prisma, tx } = setupPrivacyUpdate({ cur: { isPrivate: true } });
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
    const { svc, tx } = setupPrivacyUpdate({ cur: { isPrivate: true } });
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
      {
        get: () =>
          new Proxy(
            {},
            {
              get: (_t, method) => vi.fn(() => Promise.resolve(method === 'findMany' ? [] : row())),
            },
          ),
      },
    );
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: {
        findFirst: vi.fn(() =>
          Promise.resolve(opts.adminRole === false ? null : { id: 'r-padmin' }),
        ),
      },
      organizationMembership: {
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

  it('leadId không phải thành viên organization => lỗi, không tạo', async () => {
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
    expect(prisma.organizationMembership.findUnique).not.toHaveBeenCalled();
  });
});

describe('ProjectsService — issueCount của thẻ dự án không tính việc chưa duyệt/đã xoá', () => {
  const countWhere = (args: unknown) =>
    (
      args as {
        include: { _count: { select: { issues: { where: Record<string, unknown> } } } };
      }
    ).include._count.select.issues.where;

  it('list / getByKey / getById: `_count.issues` lọc deletedAt:null + TRIAGE_VISIBLE', async () => {
    const { service, prisma } = make();
    await service.list('w1', false, 'u1');
    await service.getByKey('w1', 'DEMO', 'u1');
    // getById (private) qua đường công khai `update`: tìm bằng findFirst có include
    await service.archive('w1', 'p1', 'u1');
    const calls = [
      ...prisma.project.findMany.mock.calls.map((c) => c[0]),
      ...prisma.project.findFirst.mock.calls.map((c) => c[0]),
    ].filter((a) => (a as { include?: unknown }).include);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const a of calls) {
      const where = countWhere(a);
      expect(where.deletedAt).toBeNull();
      expect(hasTriageVisible(where)).toBe(true);
    }
  });
});

describe('ProjectsService — nhóm dự án (programs) trong ProjectDto', () => {
  const links = [
    { program: { id: 'g1', name: 'Hạ tầng', color: '#111' } },
    { program: { id: 'g2', name: 'Khách hàng', color: null } },
  ];

  it('list/getByKey/getById đều nạp programLinks theo tên và trả `programs` ({id,name,color})', async () => {
    const { service, prisma } = make();
    prisma.project.findMany.mockResolvedValue([row({ programLinks: links })]);
    const list = await service.list('w1', false, 'u1');
    expect(list[0]!.programs).toEqual([
      { id: 'g1', name: 'Hạ tầng', color: '#111' },
      { id: 'g2', name: 'Khách hàng', color: null },
    ]);
    prisma.project.findFirst.mockResolvedValue(row({ programLinks: links }));
    expect((await service.getByKey('w1', 'DEMO', 'u1')).programs.map((p) => p.id)).toEqual([
      'g1',
      'g2',
    ]);
    expect((await service.archive('w1', 'p1', 'u1')).programs).toHaveLength(2);
    const includes = [
      ...prisma.project.findMany.mock.calls.map((c) => c[0]),
      ...prisma.project.findFirst.mock.calls.map((c) => c[0]),
    ].filter((a) => (a as { include?: unknown }).include);
    for (const a of includes)
      expect(
        (a as unknown as { include: { programLinks: unknown } }).include.programLinks,
      ).toMatchObject({
        orderBy: { program: { name: 'asc' } },
      });
  });

  it('nhóm là của riêng từng người: mọi đường nạp programLinks lọc theo CHỦ NHÓM = người xem (không lộ nhóm của người khác)', async () => {
    const { service, prisma } = make();
    prisma.project.findMany.mockResolvedValue([row({ programLinks: [] })]);
    prisma.project.findFirst.mockResolvedValue(row({ programLinks: [] }));
    await service.list('w1', false, 'viewer-1');
    await service.getByKey('w1', 'DEMO', 'viewer-2');
    await service.archive('w1', 'p1', 'viewer-3');
    const links = [
      ...prisma.project.findMany.mock.calls.map((c) => c[0]),
      ...prisma.project.findFirst.mock.calls.map((c) => c[0]),
    ]
      .filter((a) => (a as { include?: unknown }).include)
      .map(
        (a) =>
          (a as unknown as { include: { programLinks: { where: unknown } } }).include.programLinks
            .where,
      );
    expect(links).toEqual([
      { program: { ownerId: 'viewer-1' } },
      { program: { ownerId: 'viewer-2' } },
      { program: { ownerId: 'viewer-3' } },
    ]);
  });

  it('dự án chưa thuộc nhóm nào → programs = []', async () => {
    const { service } = make();
    expect((await service.list('w1', false, 'u1'))[0]!.programs).toEqual([]);
  });
});

describe('ProjectsService.create — cache quy trình của resolver (đặt defaultWorkflowId)', () => {
  function make(txBody?: (fn: (t: unknown) => unknown) => unknown) {
    const ok = () => vi.fn((_a?: unknown) => Promise.resolve({ id: 'x' }));
    const tx = {
      project: {
        create: vi.fn((_a?: unknown) => Promise.resolve(row({ id: 'p1', name: 'D' }))),
        update: ok(),
        findUnique: vi.fn(() =>
          Promise.resolve({ organizationId: 'w1', defaultWorkflowId: 'wf-clone' }),
        ),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
      ...resolverTables(),
    };
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })) },
      $transaction: vi.fn((fn: (t: unknown) => unknown) =>
        txBody ? txBody(fn) : Promise.resolve(fn(tx)),
      ),
    };
    const resolver = { invalidate: vi.fn(), forProject: vi.fn(() => Promise.resolve(new Map())) };
    const svc = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      ACCESS as never,
      AUDIT as never,
      undefined,
      resolver as never,
    );
    return { svc, resolver };
  }

  it('commit => bỏ cache của dự án vừa tạo', async () => {
    const { svc, resolver } = make();
    await svc.create('w1', 'u1', { key: 'D', name: 'D', type: 'SCRUM' } as never);
    expect(resolver.invalidate).toHaveBeenCalledWith('p1');
  });

  it('rollback ($transaction ném lỗi) => bỏ cache của MỌI dự án trong request, lỗi vẫn ném ra', async () => {
    const { svc, resolver } = make(() => Promise.reject(new Error('rollback')));
    await expect(
      svc.create('w1', 'u1', { key: 'D', name: 'D', type: 'SCRUM' } as never),
    ).rejects.toThrow('rollback');
    expect(resolver.invalidate).toHaveBeenCalledWith();
    expect(resolver.invalidate).not.toHaveBeenCalledWith('p1');
  });
});

describe('ProjectsService.create — thêm người ngay khi tạo (members)', () => {
  function make(opts: { orgMembers?: string[]; roles?: string[] } = {}) {
    const ok = () => vi.fn((_a?: unknown) => Promise.resolve({ id: 'x' }));
    const tx = {
      project: {
        create: vi.fn((_a?: unknown) => Promise.resolve(row({ id: 'p1', name: 'D' }))),
        update: ok(),
        findUnique: vi.fn(() =>
          Promise.resolve({ organizationId: 'w1', defaultWorkflowId: 'wf-clone' }),
        ),
      },
      workflow: { create: ok() },
      status: { create: ok() },
      workflowTransition: { create: ok() },
      board: { create: ok() },
      boardColumn: { create: ok() },
      boardColumnStatus: { create: ok() },
      projectMembership: { create: ok() },
      ...resolverTables(),
    };
    const prisma = {
      project: { findFirst: vi.fn(() => Promise.resolve(null)) },
      role: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'r-padmin' })),
        findMany: vi.fn(() => Promise.resolve((opts.roles ?? ['r-dev']).map((id) => ({ id })))),
      },
      organizationMembership: {
        findMany: vi.fn(() =>
          Promise.resolve((opts.orgMembers ?? ['u2', 'u3']).map((userId) => ({ userId }))),
        ),
        findUnique: vi.fn(() =>
          Promise.resolve({ id: 'm', user: { status: 'ACTIVE', email: 'a@x.vn' } }),
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
    return { svc, tx, prisma };
  }
  const memberships = (tx: { projectMembership: { create: { mock: { calls: unknown[][] } } } }) =>
    tx.projectMembership.create.mock.calls.map(
      (c) => (c as unknown as [{ data: { userId: string; roleId: string } }])[0].data,
    );

  it('mỗi người được thêm có ProjectMembership + dòng nối vai trò đã chọn, cùng transaction; người tạo vẫn là Quản trị dự án', async () => {
    const { svc, tx, prisma } = make();
    await svc.create('w1', 'u1', {
      key: 'D',
      name: 'D',
      type: 'SCRUM',
      isPrivate: true,
      members: [
        { userId: 'u2', roleId: 'r-dev' },
        { userId: 'u3', roleId: 'r-dev' },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(memberships(tx)).toEqual([
      expect.objectContaining({ userId: 'u1', roleId: 'r-padmin' }),
      expect.objectContaining({
        userId: 'u2',
        roleId: 'r-dev',
        roles: { create: [{ roleId: 'r-dev' }] },
      }),
      expect.objectContaining({ userId: 'u3', roleId: 'r-dev' }),
    ]);
  });

  it('vai trò phải là MẪU cấp dự án của tổ chức (projectId null); người phải là thành viên còn hoạt động của tổ chức', async () => {
    const { svc, prisma } = make();
    await svc.create('w1', 'u1', {
      key: 'D',
      name: 'D',
      type: 'SCRUM',
      members: [{ userId: 'u2', roleId: 'r-dev' }],
    });
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['r-dev'] },
        scope: 'PROJECT',
        projectId: null,
        OR: [{ organizationId: 'w1' }, { organizationId: null }],
      },
      select: { id: true },
    });
    expect(prisma.organizationMembership.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'w1',
        userId: { in: ['u2'] },
        user: { status: { not: 'DEACTIVATED' } },
      },
      select: { userId: true },
    });
  });

  it('bỏ qua người tạo, người phụ trách (dự án riêng tư) và trùng lặp', async () => {
    const { svc, tx } = make();
    await svc.create('w1', 'u1', {
      key: 'D',
      name: 'D',
      type: 'SCRUM',
      isPrivate: true,
      leadId: 'u2',
      members: [
        { userId: 'u1', roleId: 'r-dev' },
        { userId: 'u2', roleId: 'r-dev' },
        { userId: 'u3', roleId: 'r-dev' },
        { userId: 'u3', roleId: 'r-dev' },
      ],
    });
    // u1 (người tạo) + u2 (phụ trách, Quản trị dự án) + u3 một lần
    expect(memberships(tx).map((m) => m.userId)).toEqual(['u1', 'u2', 'u3']);
  });

  it('người không thuộc tổ chức → 422, không tạo dự án; vai trò không hợp lệ (vd vai trò riêng của dự án khác) → 403', async () => {
    const a = make({ orgMembers: [] });
    await expect(
      a.svc.create('w1', 'u1', {
        key: 'D',
        name: 'D',
        type: 'SCRUM',
        members: [{ userId: 'ghost', roleId: 'r-dev' }],
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(a.prisma.$transaction).not.toHaveBeenCalled();
    const b = make({ roles: [] });
    await expect(
      b.svc.create('w1', 'u1', {
        key: 'D',
        name: 'D',
        type: 'SCRUM',
        members: [{ userId: 'u2', roleId: 'r-other' }],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('không gửi members → không truy vấn thêm, hành vi cũ', async () => {
    const { svc, prisma } = make();
    await svc.create('w1', 'u1', { key: 'D', name: 'D', type: 'SCRUM' });
    expect(prisma.organizationMembership.findMany).not.toHaveBeenCalled();
  });
});
