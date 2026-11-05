import { describe, expect, it, vi } from 'vitest';
import { DashboardsService } from './dashboards.service';
import { matches } from './where-matcher.testutil';

const NOW = new Date('2026-10-16T01:00:00.000Z');

interface Opts {
  visibleWhere?: object;
  isAdmin?: boolean;
  canSee?: boolean;
  /** Dòng dashboard trả về từ findFirst. */
  row?: Record<string, unknown> | null;
  team?: Record<string, unknown> | null;
  project?: Record<string, unknown> | null;
  dashboardCount?: number;
  existingWidgets?: Array<{ id: string; config?: unknown }>;
  updateCount?: number;
  /** Nhóm dự án tìm được (findFirst); null = không phải của người gọi / không có. */
  program?: Record<string, unknown> | null;
  /** Dự án trả về cho findMany (phạm vi dữ liệu). */
  scopeProjects?: Array<{ id: string; key: string; name: string }>;
}

function rowOf(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    organizationId: 'w1',
    ownerId: 'u1',
    projectId: null,
    teamId: null,
    name: 'Tuần này',
    description: null,
    scope: 'PRIVATE',
    dataScope: 'ORG',
    scopeProjectId: null,
    scopeProgramId: null,
    scopeProgram: null,
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
      findMany: vi.fn(() => Promise.resolve(opts.scopeProjects ?? [{ id: 'p1' }])),
    },
    program: {
      findFirst: vi.fn(() =>
        Promise.resolve(
          opts.program === undefined ? { id: 'g1', name: 'Nhóm của tôi' } : opts.program,
        ),
      ),
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
  const svc = new DashboardsService(prisma as never, access as never);
  return { svc, prisma, access, tx };
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
    expect(where).toMatchObject({ organizationId: 'w1', deletedAt: null });
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
    expect(out[0]).toMatchObject({
      isMine: true,
      canEdit: true,
      canDelete: true,
      widgetCount: 0,
    });
    expect(out[1]).toMatchObject({
      isMine: false,
      canEdit: false,
      canDelete: false,
      widgetCount: 2,
    });
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
    });
    const d = await svc.get('w1', 'd1', 'u2');
    expect(d.widgets.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(d.canEdit).toBe(false); // u2 không phải chủ
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

  it('PROJECT: truy vấn dự án ràng organization + chưa xoá + visibleWhere của người gọi', async () => {
    const visible = { memberships: { some: { userId: 'u1' } } };
    const { svc, prisma } = make({ visibleWhere: visible });
    await svc.create('w1', 'u1', input({ scope: 'PROJECT', projectId: 'p1' }));
    const arg = JSON.stringify(prisma.project.findFirst.mock.calls[0]);
    expect(arg).toContain('"organizationId":"w1"');
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

  it('projectId trong config phải thuộc organization và người gọi thấy được → nếu không 422', async () => {
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
    expect(arg).toContain('"organizationId":"w1"');
    expect(arg).toContain('"deletedAt":null');
  });

  it('lưu: chủ = người gọi, layout chuẩn, widget kèm config/position, PRIVATE không có projectId/teamId', async () => {
    const { svc, prisma } = make();
    await svc.create('w1', 'u1', input({ description: 'mô tả' }));
    const data = (
      prisma.dashboard.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({
      organizationId: 'w1',
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

  it('I1: chỉ CHỦ sửa/đổi mức chia sẻ — admin, project:admin, trưởng nhóm đều 403, không mở giao dịch', async () => {
    const cases = [
      { row: rowOf({ scope: 'GLOBAL', ownerId: 'other' }), isAdmin: true }, // admin tổ chức
      { row: rowOf({ scope: 'PROJECT', projectId: 'p1', ownerId: 'other' }), isAdmin: false },
      {
        row: rowOf({
          scope: 'TEAM',
          teamId: 't1',
          ownerId: 'other',
          team: { id: 't1', name: 'N', leadId: 'u1' },
        }),
        isAdmin: false,
      }, // u1 là trưởng nhóm
    ];
    for (const c of cases) {
      const t = make({ row: c.row, isAdmin: c.isAdmin });
      await expect(
        t.svc.update('w1', 'd1', 'u1', update({ scope: 'PRIVATE' })),
      ).rejects.toMatchObject({ status: 403 });
      expect(t.prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('chủ đổi PROJECT → PRIVATE rồi đọc lại: không còn lỗi 404 (chủ luôn thấy bản của mình)', async () => {
    const { svc, prisma } = make({
      row: rowOf({ scope: 'PROJECT', projectId: 'p1', ownerId: 'u1' }),
    });
    await expect(svc.update('w1', 'd1', 'u1', update({ scope: 'PRIVATE' }))).resolves.toBeDefined();
    const where = JSON.stringify(prisma.dashboard.findFirst.mock.calls.at(-1));
    expect(where).toContain('"ownerId":"u1"');
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

  it('remove: chủ xoá mềm (deletedAt); người khác → 403; không thấy → 404', async () => {
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

  it('I1: admin chỉ XOÁ được (kiểm duyệt) dashboard đã chia sẻ của người khác', async () => {
    for (const scope of ['GLOBAL', 'PROJECT', 'TEAM']) {
      const t = make({ isAdmin: true, row: rowOf({ ownerId: 'other', scope }) });
      await t.svc.remove('w1', 'd1', 'adm');
      expect(t.prisma.dashboard.update).toHaveBeenCalledTimes(1);
    }
  });
});

describe('DashboardsService.duplicate — bản sao chỉ giữ cấu hình người nhân bản xem được (fix round 1, I2)', () => {
  const rowWith = (ownerId: string) =>
    rowOf({
      ownerId,
      scope: 'GLOBAL',
      widgets: [
        {
          id: 'a',
          type: 'ISSUE_LIST',
          title: 'Bí mật',
          config: { jql: 'project = SECRET AND status = Open', limit: 10 },
          position: { order: 0, w: 1 },
        },
        {
          id: 'b',
          type: 'ISSUE_LIST',
          title: 'Của tôi',
          config: { jql: 'assignee = currentUser()', limit: 5 },
          position: { order: 1, w: 1 },
        },
        {
          id: 'c',
          type: 'BURNDOWN',
          title: 'Dự án ẩn',
          config: { projectId: 'hidden' },
          position: { order: 2, w: 2 },
        },
        {
          id: 'd',
          type: 'BURNDOWN',
          title: 'Dự án thấy',
          config: { projectId: 'p1' },
          position: { order: 3, w: 2 },
        },
      ],
    });

  const copied = (prisma: ReturnType<typeof make>['prisma']) =>
    (
      prisma.dashboard.create.mock.calls[0] as unknown as [
        {
          data: { widgets: { create: Array<{ title: string; config: Record<string, unknown> }> } };
        },
      ]
    )[0].data.widgets.create;

  it('JQL nhắc dự án ẩn bị bỏ (không kèm masked), projectId ẩn bị bỏ; phần xem được giữ nguyên', async () => {
    const { svc, prisma } = make({ row: rowWith('other'), visibleWhere: { isPrivate: false } });
    prisma.project.findMany.mockImplementation(((a: { where: { NOT?: unknown } }) =>
      Promise.resolve(a.where.NOT ? [{ id: 'cabc123', key: 'SECRET' }] : [{ id: 'p1' }])) as never);
    await svc.duplicate('w1', 'd1', 'u1');
    const w = copied(prisma);
    expect(w[0]!.config).toEqual({ jql: '', limit: 10 });
    expect(JSON.stringify(w)).not.toContain('SECRET');
    expect(w[1]!.config).toEqual({ jql: 'assignee = currentUser()', limit: 5 });
    expect(w[2]!.config).toEqual({});
    expect(w[3]!.config).toEqual({ projectId: 'p1' });
  });

  it('admin thấy hết nên bản sao giữ nguyên cấu hình', async () => {
    const { svc, prisma } = make({ row: rowWith('other'), isAdmin: true });
    await svc.duplicate('w1', 'd1', 'adm');
    const w = copied(prisma);
    expect(w[0]!.config).toMatchObject({ jql: 'project = SECRET AND status = Open' });
    expect(w[2]!.config).toEqual({ projectId: 'hidden' });
  });
});

describe('DashboardsService.get — che chuỗi JQL nhắc tới dự án người xem không thấy (M7)', () => {
  const jqlRow = (ownerId: string) =>
    rowOf({
      ownerId,
      scope: 'GLOBAL',
      widgets: [
        {
          id: 'w1',
          type: 'ISSUE_LIST',
          title: 'Việc',
          config: { jql: 'project = SECRET AND status = Open', limit: 10 },
          position: { order: 0, w: 1 },
        },
        {
          id: 'w2',
          type: 'ISSUE_LIST',
          title: 'Việc 2',
          config: { jql: 'assignee = currentUser()', limit: 10 },
          position: { order: 1, w: 1 },
        },
        {
          id: 'w3',
          type: 'ISSUE_LIST',
          title: 'Việc 3',
          config: { jql: 'key = SECRET-12', limit: 10 },
          position: { order: 2, w: 1 },
        },
      ],
    });

  it('người xem khác chủ: jql nhắc dự án ẩn (mã dự án hoặc khoá việc) bị che + masked; jql khác giữ nguyên', async () => {
    const { svc, prisma } = make({ row: jqlRow('other'), visibleWhere: { isPrivate: false } });
    prisma.project.findMany.mockImplementation(((a: { where: { NOT?: unknown } }) =>
      Promise.resolve(a.where.NOT ? [{ id: 'cabc123', key: 'SECRET' }] : [{ id: 'p1' }])) as never);
    const d = await svc.get('w1', 'd1', 'u1');
    expect(d.widgets[0]!.config).toMatchObject({ jql: '', masked: true });
    expect(d.widgets[1]!.config).toEqual({ jql: 'assignee = currentUser()', limit: 10 });
    expect(d.widgets[2]!.config).toMatchObject({ jql: '', masked: true });
  });

  it('chủ và admin thấy nguyên văn (không truy vấn dự án ẩn)', async () => {
    const own = make({ row: jqlRow('u1') });
    const d1 = await own.svc.get('w1', 'd1', 'u1');
    expect(d1.widgets[0]!.config).toMatchObject({ jql: 'project = SECRET AND status = Open' });
    const adm = make({ row: jqlRow('other'), isAdmin: true });
    const d2 = await adm.svc.get('w1', 'd1', 'adm');
    expect(d2.widgets[0]!.config).toMatchObject({ jql: 'project = SECRET AND status = Open' });
    for (const t of [own, adm]) {
      expect(JSON.stringify(t.prisma.project.findMany.mock.calls)).not.toContain('"NOT"');
    }
  });
});

describe('DashboardsService — 404 theo dữ liệu thật (where được đánh giá, không chỉ so hình dạng)', () => {
  const pub = { deletedAt: null, isPrivate: false, memberships: [] };
  const priv = { deletedAt: null, isPrivate: true, memberships: [{ userId: 'pm' }] };
  const team = { deletedAt: null, leadId: 'lead', members: [{ userId: 'tm' }] };
  const data = [
    rowOf({ id: 'privOther', ownerId: 'x', scope: 'PRIVATE' }),
    rowOf({ id: 'projPriv', ownerId: 'x', scope: 'PROJECT', project: priv, projectId: 'pp' }),
    rowOf({ id: 'projPub', ownerId: 'x', scope: 'PROJECT', project: pub, projectId: 'pu' }),
    rowOf({ id: 'teamD', ownerId: 'x', scope: 'TEAM', team, teamId: 't1' }),
    rowOf({ id: 'global', ownerId: 'x', scope: 'GLOBAL' }),
  ];

  function real(userId: string, isAdmin: boolean) {
    const t = make();
    const visible = isAdmin
      ? {}
      : { OR: [{ isPrivate: false }, { memberships: { some: { userId } } }] };
    t.access.seesAll.mockResolvedValue(isAdmin);
    t.access.visibleWhere.mockResolvedValue(visible);
    t.prisma.dashboard.findFirst.mockImplementation(((a: { where: Record<string, unknown> }) =>
      Promise.resolve(data.find((r) => matches(r as never, a.where)) ?? null)) as never);
    t.prisma.dashboard.findMany.mockImplementation(((a: { where: Record<string, unknown> }) =>
      Promise.resolve(data.filter((r) => matches(r as never, a.where)))) as never);
    t.prisma.project.findMany.mockImplementation(() =>
      Promise.resolve([{ id: 'pp' }, { id: 'pu' }]),
    );
    return t;
  }

  it('người lạ: 404 cho PRIVATE người khác, dự án riêng tư, nhóm không thuộc; thấy GLOBAL và dự án công khai', async () => {
    const { svc } = real('stranger', false);
    for (const id of ['privOther', 'projPriv', 'teamD']) {
      await expect(svc.get('w1', id, 'stranger')).rejects.toMatchObject({ status: 404 });
    }
    for (const id of ['global', 'projPub']) {
      await expect(svc.get('w1', id, 'stranger')).resolves.toMatchObject({ id });
    }
    expect((await svc.list('w1', 'stranger')).map((d) => d.id).sort()).toEqual([
      'global',
      'projPub',
    ]);
  });

  it('thành viên dự án riêng tư / nhóm thấy đúng phần của mình; admin không thấy PRIVATE người khác', async () => {
    await expect(real('pm', false).svc.get('w1', 'projPriv', 'pm')).resolves.toMatchObject({
      id: 'projPriv',
    });
    await expect(real('tm', false).svc.get('w1', 'teamD', 'tm')).resolves.toMatchObject({
      id: 'teamD',
    });
    const admin = real('adm', true).svc;
    await expect(admin.get('w1', 'privOther', 'adm')).rejects.toMatchObject({ status: 404 });
    await expect(admin.get('w1', 'projPriv', 'adm')).resolves.toMatchObject({ id: 'projPriv' });
    await expect(admin.get('w1', 'teamD', 'adm')).resolves.toMatchObject({ id: 'teamD' });
  });
});

describe('DashboardsService — phạm vi dữ liệu (cổng quyền)', () => {
  it('tạo kiểu cũ (không có dataScope) bởi người thường → ORG, không bị chặn (hành vi trước khi có phạm vi dữ liệu)', async () => {
    const { svc, prisma } = make({ isAdmin: false });
    await svc.create('w1', 'u1', input());
    const data = (
      prisma.dashboard.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({ dataScope: 'ORG', scopeProjectId: null, scopeProgramId: null });
  });

  it('chọn rõ ORG khi tạo: người thường 403, admin tổ chức được', async () => {
    const a = make({ isAdmin: false });
    await expect(a.svc.create('w1', 'u1', input({ dataScope: 'ORG' }))).rejects.toMatchObject({
      status: 403,
    });
    expect(a.prisma.dashboard.create).not.toHaveBeenCalled();
    const b = make({ isAdmin: true });
    await b.svc.create('w1', 'u1', input({ dataScope: 'ORG' }));
    expect(b.prisma.dashboard.create).toHaveBeenCalled();
  });

  it('sửa: đổi sang ORG từ phạm vi khác → 403 với người thường; giữ nguyên ORG (hoặc dashboard kiểu cũ) → không 403', async () => {
    const toOrg = make({ row: rowOf({ dataScope: 'PROJECT', scopeProjectId: 'p1' }) });
    await expect(
      toOrg.svc.update('w1', 'd1', 'u1', update({ dataScope: 'ORG' })),
    ).rejects.toMatchObject({ status: 403 });

    const same = make({ row: rowOf({ dataScope: 'ORG' }) });
    await same.svc.update('w1', 'd1', 'u1', update({ dataScope: 'ORG' }));
    expect(same.tx.dashboard.updateMany).toHaveBeenCalled();

    const legacy = make({ row: rowOf({ dataScope: 'ORG' }) });
    await legacy.svc.update('w1', 'd1', 'u1', update()); // payload kiểu cũ: không có trường phạm vi dữ liệu
    const data = (
      legacy.tx.dashboard.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({ dataScope: 'ORG', scopeProjectId: null, scopeProgramId: null });
  });

  it('sửa không gửi dataScope → giữ nguyên phạm vi hiện có (không reset về ORG)', async () => {
    const { svc, tx } = make({ row: rowOf({ dataScope: 'PROJECT', scopeProjectId: 'p9' }) });
    await svc.update('w1', 'd1', 'u1', update());
    const data = (
      tx.dashboard.updateMany.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({
      dataScope: 'PROJECT',
      scopeProjectId: 'p9',
      scopeProgramId: null,
    });
  });

  it('GROUP: nhóm phải là của người gọi (tra theo ownerId); không phải chủ → 404 và không tạo', async () => {
    const mine = make();
    await mine.svc.create('w1', 'u1', input({ dataScope: 'GROUP', scopeProgramId: 'g1' }));
    const programWhere = (
      mine.prisma.program.findFirst.mock.calls[0] as unknown as [{ where: object }]
    )[0].where;
    expect(programWhere).toMatchObject({ id: 'g1', ownerId: 'u1', organizationId: 'w1' });
    const theirs = make({ program: null });
    await expect(
      theirs.svc.create('w1', 'u1', input({ dataScope: 'GROUP', scopeProgramId: 'g-other' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(theirs.prisma.dashboard.create).not.toHaveBeenCalled();
  });

  it('PROJECT: người gọi phải thấy dự án (where có bộ lọc xem); không thấy → 404', async () => {
    const visible = { OR: [{ isPrivate: false }] };
    const ok = make({ visibleWhere: visible });
    await ok.svc.create('w1', 'u1', input({ dataScope: 'PROJECT', scopeProjectId: 'p1' }));
    expect(JSON.stringify(ok.prisma.project.findFirst.mock.calls[0])).toContain(
      '"isPrivate":false',
    );
    const none = make({ project: null });
    await expect(
      none.svc.create('w1', 'u1', input({ dataScope: 'PROJECT', scopeProjectId: 'px' })),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('DashboardsService — giải phạm vi dữ liệu thành danh sách dự án', () => {
  const widgets = [
    {
      id: 'w-inherit',
      type: 'STAT_NUMBER',
      title: 'Mở',
      config: { metric: 'open' },
      position: { order: 0, w: 1 },
    },
    {
      id: 'w-own',
      type: 'PIE_BY_FIELD',
      title: 'Pie',
      config: { field: 'status', projectId: 'p-own' },
      position: { order: 1, w: 1 },
    },
  ];

  it('ORG: scopeProjects = null (không lọc), ô kế thừa projectIds null, ô tự đặt dự án giữ [dự án đó]', async () => {
    const { svc, prisma } = make({ row: rowOf({ dataScope: 'ORG', widgets }) });
    const d = await svc.get('w1', 'd1', 'u1');
    expect(d.scopeProjects).toBeNull();
    expect(d.widgets.find((w) => w.id === 'w-inherit')).toMatchObject({
      inherits: true,
      projectIds: null,
    });
    expect(d.widgets.find((w) => w.id === 'w-own')).toMatchObject({
      inherits: false,
      projectIds: ['p-own'],
    });
    expect(prisma.program.findFirst).not.toHaveBeenCalled();
  });

  it('GROUP: truy vấn dự án của nhóm GIAO với bộ lọc xem của NGƯỜI XEM; ô kế thừa nhận đúng danh sách đó', async () => {
    const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'viewer' } } }] };
    const { svc, prisma } = make({
      visibleWhere: visible,
      row: rowOf({
        ownerId: 'someone',
        scope: 'GLOBAL',
        dataScope: 'GROUP',
        scopeProgramId: 'g1',
        scopeProgram: { id: 'g1', name: 'Nhóm X' },
        widgets,
      }),
      scopeProjects: [{ id: 'pa', key: 'A', name: 'A' }],
    });
    const d = await svc.get('w1', 'd1', 'viewer');
    const where = JSON.stringify(
      (prisma.project.findMany.mock.calls as unknown as Array<[{ where: object }]>).map(
        (c) => c[0].where,
      ),
    );
    expect(where).toContain('"programLinks":{"some":{"programId":"g1"}}');
    expect(where).toContain('"userId":"viewer"'); // bộ lọc xem của người XEM, không phải của chủ
    expect(where).toContain('"deletedAt":null');
    expect(d.scopeProjects).toEqual([{ id: 'pa', key: 'A', name: 'A' }]);
    expect(d.scopeProgramName).toBe('Nhóm X');
    expect(d.widgets.find((w) => w.id === 'w-inherit')?.projectIds).toEqual(['pa']);
    expect(d.widgets.find((w) => w.id === 'w-own')?.projectIds).toEqual(['p-own']);
  });

  it('GROUP đã mất nhóm (scopeProgramId null): danh sách rỗng, không truy vấn dự án theo nhóm', async () => {
    const { svc, prisma } = make({
      row: rowOf({ dataScope: 'GROUP', scopeProgramId: null, widgets }),
    });
    const d = await svc.get('w1', 'd1', 'u1');
    expect(d.scopeProjects).toEqual([]);
    expect(d.widgets.find((w) => w.id === 'w-inherit')?.projectIds).toEqual([]);
    expect(JSON.stringify(prisma.project.findMany.mock.calls)).not.toContain('programLinks');
  });

  it('PROJECT: chỉ dự án nguồn nếu người xem thấy; không thấy → rỗng', async () => {
    const seen = make({
      row: rowOf({ dataScope: 'PROJECT', scopeProjectId: 'p1', widgets }),
      scopeProjects: [{ id: 'p1', key: 'A', name: 'A' }],
    });
    expect((await seen.svc.get('w1', 'd1', 'u1')).scopeProjects).toEqual([
      { id: 'p1', key: 'A', name: 'A' },
    ]);
    const hidden = make({
      row: rowOf({ dataScope: 'PROJECT', scopeProjectId: 'p1', widgets }),
      scopeProjects: [],
    });
    const d = await hidden.svc.get('w1', 'd1', 'u1');
    expect(d.scopeProjects).toEqual([]);
    expect(d.widgets.find((w) => w.id === 'w-inherit')?.projectIds).toEqual([]);
  });

  it('đổi phạm vi: cùng bộ ô, ô kế thừa theo phạm vi mới, ô tự đặt dự án không đổi', async () => {
    const a = make({
      row: rowOf({ dataScope: 'PROJECT', scopeProjectId: 'p1', widgets }),
      scopeProjects: [{ id: 'p1', key: 'A', name: 'A' }],
    });
    const b = make({
      row: rowOf({ dataScope: 'PROJECT', scopeProjectId: 'p2', widgets }),
      scopeProjects: [{ id: 'p2', key: 'B', name: 'B' }],
    });
    const da = await a.svc.get('w1', 'd1', 'u1');
    const db = await b.svc.get('w1', 'd1', 'u1');
    expect(da.widgets[0]!.projectIds).toEqual(['p1']);
    expect(db.widgets[0]!.projectIds).toEqual(['p2']);
    expect(da.widgets[1]!.projectIds).toEqual(['p-own']);
    expect(db.widgets[1]!.projectIds).toEqual(['p-own']);
  });
});

describe('DashboardsService.createFromTemplate / listTemplates', () => {
  it('mẫu lạ → 404; phạm vi mẫu không hỗ trợ → 422; không tạo gì', async () => {
    const a = make();
    await expect(
      a.svc.createFromTemplate('w1', 'u1', { templateKey: 'zzz', dataScope: 'ORG' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      a.svc.createFromTemplate('w1', 'u1', {
        templateKey: 'org-manager',
        dataScope: 'PROJECT',
        scopeProjectId: 'p1',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(a.prisma.dashboard.create).not.toHaveBeenCalled();
  });

  it('phạm vi PROJECT: tạo PRIVATE, ô kế thừa không mang projectId, BURNDOWN/VELOCITY mang dự án, tên mặc định theo dự án', async () => {
    const { svc, prisma } = make();
    await svc.createFromTemplate('w1', 'u1', {
      templateKey: 'project-overview',
      dataScope: 'PROJECT',
      scopeProjectId: 'p1',
    });
    const data = (
      prisma.dashboard.create.mock.calls[0] as unknown as [
        {
          data: {
            name: string;
            scope: string;
            dataScope: string;
            scopeProjectId: string;
            widgets: { create: Array<{ type: string; config: Record<string, unknown> }> };
          };
        },
      ]
    )[0].data;
    expect(data).toMatchObject({ scope: 'PRIVATE', dataScope: 'PROJECT', scopeProjectId: 'p1' });
    expect(data.name).toBe('Tổng quan dự án · Dự án A');
    const byType = (t: string) => data.widgets.create.filter((w) => w.type === t);
    expect(byType('BURNDOWN')[0]!.config).toMatchObject({ projectId: 'p1' });
    expect(byType('VELOCITY')[0]!.config).toMatchObject({ projectId: 'p1' });
    for (const w of [...byType('STAT_NUMBER'), ...byType('PIE_BY_FIELD')])
      expect(w.config).not.toHaveProperty('projectId');
  });

  it('phạm vi GROUP: bỏ BURNDOWN/VELOCITY; ORG: người thường 403, admin tạo được; dashboard Trống không có ô', async () => {
    const g = make();
    await g.svc.createFromTemplate('w1', 'u1', {
      templateKey: 'project-overview',
      dataScope: 'GROUP',
      scopeProgramId: 'g1',
      name: 'Của tôi',
    });
    const created = (
      g.prisma.dashboard.create.mock.calls[0] as unknown as [
        { data: { name: string; widgets: { create: Array<{ type: string }> } } },
      ]
    )[0].data;
    expect(created.name).toBe('Của tôi');
    expect(created.widgets.create.map((w) => w.type)).not.toContain('BURNDOWN');
    expect(created.widgets.create.map((w) => w.type)).not.toContain('VELOCITY');

    const denied = make({ isAdmin: false });
    await expect(
      denied.svc.createFromTemplate('w1', 'u1', { templateKey: 'org-manager', dataScope: 'ORG' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(denied.prisma.dashboard.create).not.toHaveBeenCalled();

    const admin = make({ isAdmin: true });
    await admin.svc.createFromTemplate('w1', 'u1', {
      templateKey: 'org-manager',
      dataScope: 'ORG',
    });
    expect(admin.prisma.dashboard.create).toHaveBeenCalled();

    const blank = make();
    await blank.svc.createFromTemplate('w1', 'u1', {
      templateKey: 'blank',
      dataScope: 'PROJECT',
      scopeProjectId: 'p1',
    });
    const b = (
      blank.prisma.dashboard.create.mock.calls[0] as unknown as [
        { data: { widgets: { create: unknown[] } } },
      ]
    )[0].data;
    expect(b.widgets.create).toEqual([]);
  });

  it('đủ hạn mức dashboard → chặn như tạo thường', async () => {
    const { svc, prisma } = make({ dashboardCount: 30 });
    await expect(
      svc.createFromTemplate('w1', 'u1', {
        templateKey: 'blank',
        dataScope: 'PROJECT',
        scopeProjectId: 'p1',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.dashboard.create).not.toHaveBeenCalled();
  });

  it('listTemplates: trả mẫu + canUseOrgScope theo admin tổ chức', async () => {
    const user = await make({ isAdmin: false }).svc.listTemplates('w1', 'u1');
    expect(user.canUseOrgScope).toBe(false);
    expect(user.templates.map((t) => t.key)).toContain('qa');
    expect((await make({ isAdmin: true }).svc.listTemplates('w1', 'u1')).canUseOrgScope).toBe(true);
  });
});

describe('DashboardsService.duplicate — phạm vi dữ liệu', () => {
  it('giữ PROJECT khi người nhân bản thấy dự án; không thấy → về ORG', async () => {
    const row = rowOf({
      ownerId: 'x',
      scope: 'GLOBAL',
      dataScope: 'PROJECT',
      scopeProjectId: 'p1',
    });
    const seen = make({ row });
    await seen.svc.duplicate('w1', 'd1', 'u1');
    expect(
      (seen.prisma.dashboard.create.mock.calls[0] as unknown as [{ data: object }])[0].data,
    ).toMatchObject({ dataScope: 'PROJECT', scopeProjectId: 'p1' });
    const hidden = make({ row, project: null });
    await hidden.svc.duplicate('w1', 'd1', 'u1');
    expect(
      (hidden.prisma.dashboard.create.mock.calls[0] as unknown as [{ data: object }])[0].data,
    ).toMatchObject({ dataScope: 'ORG', scopeProjectId: null });
  });

  it('GROUP của người khác không bao giờ sang bản sao (về ORG); của chính mình thì giữ', async () => {
    const row = rowOf({ ownerId: 'x', scope: 'GLOBAL', dataScope: 'GROUP', scopeProgramId: 'g-x' });
    const others = make({ row, program: null });
    await others.svc.duplicate('w1', 'd1', 'u1');
    expect(
      (others.prisma.dashboard.create.mock.calls[0] as unknown as [{ data: object }])[0].data,
    ).toMatchObject({ dataScope: 'ORG', scopeProgramId: null });
    const mine = make({ row, program: { id: 'g-x' } });
    await mine.svc.duplicate('w1', 'd1', 'u1');
    expect(
      (mine.prisma.dashboard.create.mock.calls[0] as unknown as [{ data: object }])[0].data,
    ).toMatchObject({ dataScope: 'GROUP', scopeProgramId: 'g-x' });
  });
});
