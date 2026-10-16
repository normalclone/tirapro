import { describe, expect, it, vi } from 'vitest';
import { DashboardsService } from './dashboards.service';

const NOW = new Date('2026-10-16T01:00:00.000Z');

interface Opts {
  visibleWhere?: object;
  isAdmin?: boolean;
  canSee?: boolean;
  /** Dòng dashboard trả về từ findFirst. */
  row?: Record<string, unknown> | null;
  perms?: string[];
  team?: Record<string, unknown> | null;
  project?: Record<string, unknown> | null;
  dashboardCount?: number;
  existingWidgets?: Array<{ id: string; config?: unknown }>;
  updateCount?: number;
}

function rowOf(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    workspaceId: 'w1',
    ownerId: 'u1',
    projectId: null,
    teamId: null,
    name: 'Tuần này',
    description: null,
    scope: 'PRIVATE',
    layout: { version: 1, columns: 3 },
    updatedAt: NOW,
    owner: { id: 'u1', displayName: 'An', avatarUrl: null },
    project: null,
    team: null,
    widgets: [],
    _count: { widgets: 0 },
    ...over,
  };
}

function make(opts: Opts = {}) {
  const tx = {
    dashboard: {
      updateMany: vi.fn(() => Promise.resolve({ count: opts.updateCount ?? 1 })),
    },
    widget: {
      findMany: vi.fn(() => Promise.resolve(opts.existingWidgets ?? [])),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      update: vi.fn(() => Promise.resolve({})),
      create: vi.fn(() => Promise.resolve({})),
    },
  };
  const prisma = {
    dashboard: {
      findMany: vi.fn(() => Promise.resolve([] as unknown[])),
      findFirst: vi.fn(() =>
        Promise.resolve(
          opts.row === undefined ? rowOf({ widgets: opts.existingWidgets ?? [] }) : opts.row,
        ),
      ),
      count: vi.fn(() => Promise.resolve(opts.dashboardCount ?? 0)),
      create: vi.fn(() => Promise.resolve({ id: 'd-new' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    project: {
      findFirst: vi.fn(() =>
        Promise.resolve(
          opts.project === undefined
            ? { id: 'p1', archivedAt: null, key: 'A', name: 'Dự án A' }
            : opts.project,
        ),
      ),
      findMany: vi.fn(() => Promise.resolve([{ id: 'p1' }])),
    },
    team: {
      findFirst: vi.fn(() =>
        Promise.resolve(
          opts.team === undefined
            ? { id: 't1', leadId: 'lead', members: [] as Array<{ userId: string }> }
            : opts.team,
        ),
      ),
    },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx))),
  };
  const access = {
    seesAll: vi.fn(() => Promise.resolve(opts.isAdmin ?? false)),
    visibleWhere: vi.fn(() => Promise.resolve(opts.visibleWhere ?? {})),
    canSee: vi.fn(() => Promise.resolve(opts.canSee ?? true)),
  };
  const rbac = {
    getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(opts.perms ?? []))),
  };
  const svc = new DashboardsService(prisma as never, access as never, rbac as never);
  return { svc, prisma, access, rbac, tx };
}

const widget = (over: Record<string, unknown> = {}) => ({
  type: 'STAT_NUMBER' as const,
  title: 'Việc mở',
  config: { metric: 'open' },
  position: { order: 0, w: 1 as const },
  ...over,
});
const input = (over: Record<string, unknown> = {}) =>
  ({ name: 'Mới', scope: 'PRIVATE', widgets: [widget()], ...over }) as never;
const update = (over: Record<string, unknown> = {}) =>
  ({ ...(input(over) as object), updatedAt: NOW.toISOString() }) as never;

describe('DashboardsService.list', () => {
  it('where gồm 4 mức + chủ, luôn deletedAt:null; project dùng visibleWhere của P12; team lọc theo thành viên/trưởng nhóm', async () => {
    const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
    const { svc, prisma } = make({ visibleWhere: visible });
    await svc.list('w1', 'u1');
    const where = (prisma.dashboard.findMany.mock.calls[0] as unknown as [{ where: object }])[0]
      .where;
    expect(where).toMatchObject({ workspaceId: 'w1', deletedAt: null });
    const json = JSON.stringify(where);
    expect(json).toContain('"ownerId":"u1"');
    expect(json).toContain('"scope":"GLOBAL"');
    expect(json).toContain('"isPrivate":false');
    expect(json).toContain('"members":{"some":{"userId":"u1"}}');
  });

  it('trả tóm tắt có canEdit/isMine, của tôi trước, không kèm widget', async () => {
    const { svc, prisma } = make();
    prisma.dashboard.findMany.mockResolvedValue([
      rowOf({ id: 'a', ownerId: 'x', scope: 'GLOBAL', name: 'Chung', _count: { widgets: 2 } }),
      rowOf({ id: 'b', ownerId: 'u1', scope: 'PRIVATE', name: 'Của tôi' }),
    ]);
    const out = await svc.list('w1', 'u1');
    expect(out.map((d) => d.id)).toEqual(['b', 'a']);
    expect(out[0]).toMatchObject({ isMine: true, canEdit: true, widgetCount: 0 });
    expect(out[1]).toMatchObject({ isMine: false, canEdit: false, widgetCount: 2 });
    expect(out[0]).not.toHaveProperty('widgets');
  });
});

describe('DashboardsService.get', () => {
  it('PROJECT của dự án riêng tư mà người xem không thuộc → 404 (where không có đường lọt)', async () => {
    const { svc, prisma } = make({
      row: null,
      visibleWhere: { memberships: { some: { userId: 'u9' } } },
    });
    await expect(svc.get('w1', 'd1', 'u9')).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(prisma.dashboard.findFirst.mock.calls[0])).toContain('"id":"d1"');
  });

  it('PRIVATE của người khác → 404 kể cả admin (where không có nhánh PRIVATE ngoài ownerId)', async () => {
    const { svc, prisma } = make({ row: null, isAdmin: true });
    await expect(svc.get('w1', 'd1', 'admin')).rejects.toMatchObject({ status: 404 });
    const s = JSON.stringify(prisma.dashboard.findFirst.mock.calls[0]);
    expect(s).not.toContain('"scope":"PRIVATE"');
    expect(s).toContain('"ownerId":"admin"');
  });

  it('TEAM không thuộc nhóm → 404; admin dùng điều kiện nhóm không ràng thành viên', async () => {
    const member = make({ row: null });
    await expect(member.svc.get('w1', 'd1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(member.prisma.dashboard.findFirst.mock.calls[0])).toContain(
      '"leadId":"u1"',
    );
    const admin = make({ isAdmin: true });
    await admin.svc.get('w1', 'd1', 'adm');
    expect(JSON.stringify(admin.prisma.dashboard.findFirst.mock.calls[0])).not.toContain(
      '"members"',
    );
  });

  it('trả widget theo position.order, kèm canEdit/owner/project/team', async () => {
    const { svc } = make({
      row: rowOf({
        scope: 'PROJECT',
        projectId: 'p1',
        project: { id: 'p1', key: 'A', name: 'Dự án A' },
        widgets: [
          { id: 'w2', type: 'TOP_RISKS', title: 'B', config: {}, position: { order: 2, w: 1 } },
          { id: 'w1', type: 'OVERLOAD', title: 'A', config: {}, position: { order: 0, w: 2 } },
        ],
      }),
      perms: ['project:admin'],
    });
    const d = await svc.get('w1', 'd1', 'u2');
    expect(d.widgets.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(d.canEdit).toBe(true);
    expect(d.project).toEqual({ id: 'p1', key: 'A', name: 'Dự án A' });
  });

  it('chủ đã mất quyền xem dự án: vẫn thấy dashboard nhưng không lộ tên dự án', async () => {
    const { svc, prisma } = make({
      row: rowOf({
        scope: 'PROJECT',
        projectId: 'p1',
        project: { id: 'p1', key: 'A', name: 'Dự án mật' },
      }),
      visibleWhere: { memberships: { some: { userId: 'u1' } } },
    });
    prisma.project.findMany.mockResolvedValue([]); // không còn thấy dự án nào
    const d = await svc.get('w1', 'd1', 'u1');
    expect(d.project).toBeNull();
  });
});

describe('DashboardsService.create', () => {
  it('PROJECT: không canSee (ngoài tầm nhìn) → 404; dự án lưu trữ → 422', async () => {
    const hidden = make({ project: null });
    await expect(
      hidden.svc.create('w1', 'u1', input({ scope: 'PROJECT', projectId: 'p1' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(hidden.prisma.dashboard.create).not.toHaveBeenCalled();
    const archived = make({ project: { id: 'p1', archivedAt: new Date(), key: 'A', name: 'A' } });
    await expect(
      archived.svc.create('w1', 'u1', input({ scope: 'PROJECT', projectId: 'p1' })),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('PROJECT: truy vấn dự án ràng workspace + chưa xoá + visibleWhere của người gọi', async () => {
    const visible = { memberships: { some: { userId: 'u1' } } };
    const { svc, prisma } = make({ visibleWhere: visible });
    await svc.create('w1', 'u1', input({ scope: 'PROJECT', projectId: 'p1' }));
    const arg = JSON.stringify(prisma.project.findFirst.mock.calls[0]);
    expect(arg).toContain('"workspaceId":"w1"');
    expect(arg).toContain('"deletedAt":null');
    expect(arg).toContain('"memberships"');
  });

  it('TEAM: không thuộc nhóm → 403; trưởng nhóm/thành viên/admin → ok', async () => {
    const outsider = make();
    await expect(
      outsider.svc.create('w1', 'u1', input({ scope: 'TEAM', teamId: 't1' })),
    ).rejects.toMatchObject({ status: 403 });
    const member = make({ team: { id: 't1', leadId: 'x', members: [{ userId: 'u1' }] } });
    await member.svc.create('w1', 'u1', input({ scope: 'TEAM', teamId: 't1' }));
    expect(member.prisma.dashboard.create).toHaveBeenCalledTimes(1);
    const lead = make({ team: { id: 't1', leadId: 'u1', members: [] } });
    await lead.svc.create('w1', 'u1', input({ scope: 'TEAM', teamId: 't1' }));
    expect(lead.prisma.dashboard.create).toHaveBeenCalledTimes(1);
    const admin = make({ isAdmin: true });
    await admin.svc.create('w1', 'adm', input({ scope: 'TEAM', teamId: 't1' }));
    expect(admin.prisma.dashboard.create).toHaveBeenCalledTimes(1);
  });

  it('TEAM: nhóm không tồn tại/đã xoá → 404', async () => {
    const { svc } = make({ team: null });
    await expect(
      svc.create('w1', 'u1', input({ scope: 'TEAM', teamId: 'tx' })),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('>12 widget hoặc ≥30 dashboard/người → 422', async () => {
    const many = Array.from({ length: 13 }, (_, i) => widget({ position: { order: i, w: 1 } }));
    await expect(make().svc.create('w1', 'u1', input({ widgets: many }))).rejects.toMatchObject({
      status: 422,
    });
    const full = make({ dashboardCount: 30 });
    await expect(full.svc.create('w1', 'u1', input())).rejects.toMatchObject({ status: 422 });
    expect(full.prisma.dashboard.create).not.toHaveBeenCalled();
  });

  it('projectId trong config phải thuộc workspace và người gọi thấy được → nếu không 422', async () => {
    const { svc, prisma } = make();
    prisma.project.findMany.mockResolvedValue([]); // không tìm thấy dự án trong config
    await expect(
      svc.create(
        'w1',
        'u1',
        input({ widgets: [widget({ type: 'BURNDOWN', config: { projectId: 'px' } })] }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    const arg = JSON.stringify(prisma.project.findMany.mock.calls[0]);
    expect(arg).toContain('"workspaceId":"w1"');
    expect(arg).toContain('"deletedAt":null');
  });

  it('lưu: chủ = người gọi, layout chuẩn, widget kèm config/position, PRIVATE không có projectId/teamId', async () => {
    const { svc, prisma } = make();
    await svc.create('w1', 'u1', input({ description: 'mô tả' }));
    const data = (
      prisma.dashboard.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({
      workspaceId: 'w1',
      ownerId: 'u1',
      name: 'Mới',
      scope: 'PRIVATE',
      projectId: null,
      teamId: null,
      layout: { version: 1, columns: 3 },
    });
    expect(JSON.stringify(data.widgets)).toContain('"metric":"open"');
  });
});

describe('DashboardsService.update', () => {
  it('đổi từ PROJECT sang GLOBAL xoá projectId', async () => {
    const { svc, tx } = make({ row: rowOf({ scope: 'PROJECT', projectId: 'p1', ownerId: 'u1' }) });
    await svc.update('w1', 'd1', 'u1', update({ scope: 'GLOBAL' }));
    const call = tx.dashboard.updateMany.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data).toMatchObject({ scope: 'GLOBAL', projectId: null, teamId: null });
  });

  it('người không có quyền sửa → 403; project:admin của dự án sửa được', async () => {
    const row = rowOf({ scope: 'PROJECT', projectId: 'p1', ownerId: 'other' });
    const denied = make({ row });
    await expect(
      denied.svc.update('w1', 'd1', 'u1', update({ scope: 'PROJECT', projectId: 'p1' })),
    ).rejects.toMatchObject({ status: 403 });
    expect(denied.prisma.$transaction).not.toHaveBeenCalled();
    const ok = make({ row, perms: ['project:admin'] });
    await ok.svc.update('w1', 'd1', 'u1', update({ scope: 'PROJECT', projectId: 'p1' }));
    expect(ok.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ok.rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p1');
  });

  it('thay widget trong 1 $transaction: giữ id cũ (update), tạo mới, xoá widget thiếu', async () => {
    const { svc, tx, prisma } = make({ existingWidgets: [{ id: 'k1' }, { id: 'k2' }] });
    await svc.update(
      'w1',
      'd1',
      'u1',
      update({
        widgets: [
          widget({ id: 'k1', title: 'Giữ' }),
          widget({ title: 'Mới', position: { order: 1, w: 2 } }),
        ],
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.widget.deleteMany).toHaveBeenCalledWith({
      where: { dashboardId: 'd1', id: { in: ['k2'] } },
    });
    expect(tx.widget.update).toHaveBeenCalledTimes(1);
    expect(tx.widget.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(tx.widget.create.mock.calls[0])).toContain('"dashboardId":"d1"');
  });

  it('updatedAt lệch (updateMany count 0) → 409 và không đụng widget', async () => {
    const { svc, tx } = make({ updateCount: 0 });
    await expect(svc.update('w1', 'd1', 'u1', update())).rejects.toMatchObject({ status: 409 });
    expect(tx.widget.findMany).not.toHaveBeenCalled();
    const arg = JSON.stringify(tx.dashboard.updateMany.mock.calls[0]);
    expect(arg).toContain(NOW.toISOString());
    expect(arg).toContain('"deletedAt":null');
  });

  it('không thấy dashboard → 404 (không phân biệt không tồn tại)', async () => {
    const { svc } = make({ row: null });
    await expect(svc.update('w1', 'dx', 'u1', update())).rejects.toMatchObject({ status: 404 });
  });

  it('sửa dashboard của dự án đã lưu trữ → 422', async () => {
    const { svc } = make({
      row: rowOf({ scope: 'PROJECT', projectId: 'p1' }),
      project: { id: 'p1', archivedAt: new Date(), key: 'A', name: 'A' },
    });
    await expect(
      svc.update('w1', 'd1', 'u1', update({ scope: 'PROJECT', projectId: 'p1' })),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('giữ nguyên dự án trong config đã lưu thì không đòi quyền thấy dự án đó (không chặn sửa vì ô cũ)', async () => {
    const { svc, prisma } = make({
      existingWidgets: [{ id: 'k1', config: { projectId: 'p-hidden' } }],
    });
    prisma.project.findMany.mockResolvedValue([]);
    await expect(
      svc.update(
        'w1',
        'd1',
        'u1',
        update({
          widgets: [widget({ id: 'k1', type: 'BURNDOWN', config: { projectId: 'p-hidden' } })],
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('DashboardsService.duplicate / remove', () => {
  it('duplicate: bản PRIVATE của người gọi, tên "… (bản sao)", sao chép widget', async () => {
    const { svc, prisma } = make({
      row: rowOf({
        ownerId: 'other',
        scope: 'GLOBAL',
        name: 'Chung',
        widgets: [
          { id: 'w1', type: 'TOP_RISKS', title: 'R', config: {}, position: { order: 0, w: 1 } },
        ],
      }),
    });
    await svc.duplicate('w1', 'd1', 'u1');
    const data = (
      prisma.dashboard.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({
      ownerId: 'u1',
      scope: 'PRIVATE',
      name: 'Chung (bản sao)',
      projectId: null,
      teamId: null,
    });
    expect(JSON.stringify(data.widgets)).toContain('TOP_RISKS');
  });

  it('duplicate: tên dài được cắt vừa 120 ký tự; vượt hạn mức → 422', async () => {
    const long = 'x'.repeat(120);
    const { svc, prisma } = make({ row: rowOf({ name: long }) });
    await svc.duplicate('w1', 'd1', 'u1');
    const data = (
      prisma.dashboard.create.mock.calls[0] as unknown as [{ data: { name: string } }]
    )[0].data;
    expect(data.name.length).toBeLessThanOrEqual(120);
    expect(data.name.endsWith('(bản sao)')).toBe(true);
    await expect(
      make({ dashboardCount: 30 }).svc.duplicate('w1', 'd1', 'u1'),
    ).rejects.toMatchObject({
      status: 422,
    });
  });

  it('remove: xoá mềm (deletedAt) khi có quyền; người khác → 403; không thấy → 404', async () => {
    const ok = make();
    await ok.svc.remove('w1', 'd1', 'u1');
    expect(ok.prisma.dashboard.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { deletedAt: expect.any(Date) as unknown },
    });
    const denied = make({ row: rowOf({ ownerId: 'other', scope: 'GLOBAL' }) });
    await expect(denied.svc.remove('w1', 'd1', 'u1')).rejects.toMatchObject({ status: 403 });
    await expect(make({ row: null }).svc.remove('w1', 'd1', 'u1')).rejects.toMatchObject({
      status: 404,
    });
  });
});
