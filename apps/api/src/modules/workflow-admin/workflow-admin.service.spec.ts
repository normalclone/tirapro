import { describe, expect, it, vi } from 'vitest';
import { Prisma as PrismaErrors } from '@prisma/client';
import { WorkflowAdminService } from './workflow-admin.service';

const ARCHIVED = 'Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi';

/** Prisma giả: workflow `wf1` thuộc dự án `p1` (hoặc cấp tổ chức khi `projectId = null`). */
/** Người xem thấy mọi dự án (admin): visibleWhere = {}. */
const ALL_ACCESS = { visibleWhere: vi.fn(() => Promise.resolve({})) };

function make(opts: {
  projectId: string | null;
  archived?: boolean;
  rules?: Array<Record<string, unknown>>;
}) {
  const rules = (opts.rules ?? []).map((r) => ({
    projectId: null,
    createdById: 'u-rule',
    enabled: true,
    triggerConfig: {},
    conditions: [],
    actions: [],
    ...r,
  })) as unknown as Array<Record<string, unknown> & { id: string }>;
  const wfRow = {
    id: 'wf1',
    organizationId: 'w1',
    projectId: opts.projectId,
    name: 'WF',
    description: null,
    isTemplate: false,
    isDefault: false,
    sourceTemplateId: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    statuses: [],
    transitions: [],
  };
  const statusRow = {
    id: 's1',
    workflowId: 'wf1',
    name: 'Todo',
    category: 'TODO',
    color: null,
    order: 0,
    isInitial: false,
  };
  const transRow = {
    id: 't1',
    workflowId: 'wf1',
    name: 'Go',
    fromStatusId: null,
    toStatusId: 's1',
    order: 0,
  };
  const prisma = {
    workflow: {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'wf1', organizationId: 'w1', projectId: opts.projectId }),
      ),
      create: vi.fn(() => Promise.resolve(wfRow)),
      update: vi.fn(() => Promise.resolve(wfRow)),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      delete: vi.fn(() => Promise.resolve({})),
    },
    status: {
      findMany: vi.fn(() => Promise.resolve([])),
      findFirst: vi.fn(() =>
        Promise.resolve({ ...statusRow, workflow: { projectId: opts.projectId } }),
      ),
      create: vi.fn(() => Promise.resolve(statusRow)),
      update: vi.fn(() => Promise.resolve(statusRow)),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      delete: vi.fn(() => Promise.resolve({})),
    },
    workflowTransition: {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 't1', workflowId: 'wf1', workflow: { projectId: opts.projectId } }),
      ),
      create: vi.fn(() => Promise.resolve(transRow)),
      update: vi.fn(() => Promise.resolve(transRow)),
      delete: vi.fn(() => Promise.resolve({})),
    },
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: opts.archived ? new Date() : null })),
      count: vi.fn(() => Promise.resolve(0)),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    issue: { count: vi.fn(() => Promise.resolve(0)) },
    // Quy trình theo loại việc: mặc định không có gán nào.
    organizationWorkflowScheme: {
      findMany: vi.fn(() => Promise.resolve([])),
      count: vi.fn(() => Promise.resolve(0)),
    },
    projectWorkflowOverride: {
      findMany: vi.fn(() => Promise.resolve([])),
      count: vi.fn(() => Promise.resolve(0)),
    },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
    $executeRaw: vi.fn((..._a: unknown[]) => Promise.resolve(0)),
    user: { upsert: vi.fn(() => Promise.resolve({ id: 'SYS' })) },
    automationRule: {
      findMany: vi.fn(() => Promise.resolve(rules.map((r) => ({ ...r })))),
      update: vi.fn((a: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(rules.find((r) => r.id === a.where.id)!, a.data);
        return Promise.resolve({});
      }),
    },
  };
  const published: Array<{ recipientId: string; payload: unknown; force?: boolean }> = [];
  const notifications = {
    publish: vi.fn((n: { recipientId: string; payload: unknown }, o?: { force?: boolean }) => {
      published.push({ ...n, force: o?.force });
      return Promise.resolve();
    }),
  };
  const events = { emit: vi.fn() };
  const resolver = { invalidate: vi.fn() };
  const service = new WorkflowAdminService(
    prisma as never,
    ALL_ACCESS as never,
    notifications as never,
    events as never,
    resolver as never,
  );
  return { service, prisma, rules, published, events, resolver };
}

/** Mọi đường ghi của service: [tên, hàm gọi, hàm trả về các mock ghi để kiểm "không ghi"]. */
type Prisma = ReturnType<typeof make>['prisma'];
const WRITES: Array<
  [string, (s: WorkflowAdminService) => Promise<unknown>, (p: Prisma) => unknown[]]
> = [
  [
    'createWorkflow(projectId)',
    (s) => s.createWorkflow('w1', { name: 'N', projectId: 'p1' }),
    (p) => [p.workflow.create],
  ],
  [
    'updateWorkflow',
    (s) => s.updateWorkflow('w1', 'wf1', { name: 'N', isDefault: true }),
    (p) => [p.workflow.update, p.workflow.updateMany],
  ],
  ['removeWorkflow', (s) => s.removeWorkflow('w1', 'wf1'), (p) => [p.workflow.delete]],
  [
    'createStatus',
    (s) => s.createStatus('w1', 'wf1', { name: 'N', category: 'TODO', isInitial: true }),
    (p) => [p.status.create, p.status.updateMany],
  ],
  [
    'updateStatus',
    (s) => s.updateStatus('w1', 's1', { name: 'N', isInitial: true }),
    (p) => [p.status.update, p.status.updateMany],
  ],
  ['removeStatus', (s) => s.removeStatus('w1', 'u1', 's1'), (p) => [p.status.delete]],
  [
    'createTransition',
    (s) => s.createTransition('w1', 'wf1', { name: 'N', toStatusId: 's1' }),
    (p) => [p.workflowTransition.create],
  ],
  [
    'updateTransition',
    (s) => s.updateTransition('w1', 't1', { name: 'N' }),
    (p) => [p.workflowTransition.update],
  ],
  ['removeTransition', (s) => s.removeTransition('w1', 't1'), (p) => [p.workflowTransition.delete]],
];

describe('WorkflowAdminService — workflow thuộc dự án lưu trữ là chỉ đọc (FW5)', () => {
  it.each(WRITES)('%s: dự án đã lưu trữ => 422, không ghi gì', async (_n, call, writes) => {
    const { service, prisma } = make({ projectId: 'p1', archived: true });
    await expect(call(service)).rejects.toMatchObject({ status: 422, message: ARCHIVED });
    for (const w of writes(prisma)) expect(w).not.toHaveBeenCalled();
  });

  it.each(WRITES.slice(1))(
    '%s: workflow cấp organization (không có projectId) không bị chặn, không tra dự án',
    async (_n, call) => {
      const { service, prisma } = make({ projectId: null, archived: true });
      await expect(call(service)).resolves.toBeDefined();
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each(WRITES)('%s: dự án đang hoạt động => ghi bình thường', async (_n, call, writes) => {
    const { service, prisma } = make({ projectId: 'p1', archived: false });
    await expect(call(service)).resolves.toBeDefined();
    expect(
      writes(prisma).some((w) => (w as { mock: { calls: unknown[] } }).mock.calls.length),
    ).toBe(true);
  });

  it('createWorkflow không gắn dự án (workflow cấp organization) => không chặn', async () => {
    const { service, prisma } = make({ projectId: null, archived: true });
    await expect(service.createWorkflow('w1', { name: 'N' })).resolves.toBeDefined();
    expect(prisma.workflow.create).toHaveBeenCalled();
  });
});

describe('WorkflowAdminService.listWorkflows — usedBy', () => {
  const wfRow = (id: string) => ({
    id,
    organizationId: 'w1',
    projectId: null,
    name: id,
    description: null,
    isTemplate: false,
    isDefault: false,
    sourceTemplateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    statuses: [],
    transitions: [],
  });

  it('gắn danh sách dự án đang dùng cho từng quy trình', async () => {
    const prisma = {
      workflow: { findMany: vi.fn(() => Promise.resolve([wfRow('w1'), wfRow('w2')])) },
      organizationWorkflowScheme: { findMany: vi.fn(() => Promise.resolve([])) },
      projectWorkflowOverride: { findMany: vi.fn(() => Promise.resolve([])) },
      project: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { id: 'p1', key: 'WM', name: 'Website', defaultWorkflowId: 'w1', deletedAt: null },
            { id: 'p2', key: 'OLD', name: 'Cũ', defaultWorkflowId: 'w1', deletedAt: new Date() },
          ]),
        ),
      },
    };
    const svc = new WorkflowAdminService(prisma as never, ALL_ACCESS as never);
    const out = await svc.listWorkflows('ws1', {}, 'u1');
    expect(out.find((w) => w.id === 'w1')!.usedBy.projects).toEqual([
      { id: 'p1', key: 'WM', name: 'Website', deleted: false },
      { id: 'p2', key: 'OLD', name: 'Cũ', deleted: true },
    ]);
    expect(out.find((w) => w.id === 'w2')!.usedBy.projects).toEqual([]);
    expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
  });

  it('getWorkflow cũng trả usedBy', async () => {
    const prisma = {
      workflow: { findFirst: vi.fn(() => Promise.resolve(wfRow('w1'))) },
      organizationWorkflowScheme: { findMany: vi.fn(() => Promise.resolve([])) },
      projectWorkflowOverride: { findMany: vi.fn(() => Promise.resolve([])) },
      project: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { id: 'p1', key: 'WM', name: 'Website', defaultWorkflowId: 'w1', deletedAt: null },
          ]),
        ),
      },
    };
    const out = await new WorkflowAdminService(prisma as never, ALL_ACCESS as never).getWorkflow(
      'ws1',
      'w1',
      'u1',
    );
    expect(out.usedBy.projects).toEqual([{ id: 'p1', key: 'WM', name: 'Website', deleted: false }]);
  });

  it('removeWorkflow: đang dùng → báo mã dự án đang dùng, không xoá', async () => {
    const { service, prisma } = make({ projectId: null });
    prisma.project.findMany.mockResolvedValueOnce([{ key: 'WM' }, { key: 'HR' }] as never);
    await expect(service.removeWorkflow('w1', 'wf1')).rejects.toThrow(/WM, HR.*kể cả dự án đã xoá/);
    expect(prisma.workflow.delete).not.toHaveBeenCalled();
  });
});

describe('WorkflowAdminService — dự án riêng tư: quy trình và "Dùng bởi" (P15)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const wfRow = (id: string, projectId: string | null = null) => ({
    id,
    organizationId: 'w1',
    projectId,
    name: id,
    description: null,
    isTemplate: false,
    isDefault: false,
    sourceTemplateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    statuses: [],
    transitions: [],
  });

  function build(visibleWhere: Record<string, unknown>) {
    const prisma = {
      workflow: {
        findMany: vi.fn((..._a: unknown[]) => Promise.resolve([wfRow('tpl')])),
        findFirst: vi.fn((..._a: unknown[]) => Promise.resolve(wfRow('tpl'))),
      },
      organizationWorkflowScheme: { findMany: vi.fn(() => Promise.resolve([])) },
      projectWorkflowOverride: {
        findMany: vi.fn((..._a: unknown[]) => Promise.resolve([])),
        groupBy: vi.fn((..._a: unknown[]) => Promise.resolve([])),
      },
      project: {
        // dự án thấy được dùng 'tpl': WM; 1 dự án riêng tư HR cũng dùng nhưng bị loại ở truy vấn thứ nhất
        findMany: vi.fn((..._a: unknown[]) =>
          Promise.resolve([
            { id: 'p1', key: 'WM', name: 'Website', defaultWorkflowId: 'tpl', deletedAt: null },
          ]),
        ),
        groupBy: vi.fn((..._a: unknown[]) =>
          Promise.resolve([{ defaultWorkflowId: 'tpl', _count: { _all: 1 } }]),
        ),
      },
    };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visibleWhere)) };
    return { svc: new WorkflowAdminService(prisma as never, access as never), prisma, access };
  }

  it('usedBy chỉ gồm dự án thấy được; hiddenCount = số dự án riêng tư không thấy (không lộ khoá/tên)', async () => {
    const { svc, prisma } = build(visible);
    const [wf] = await svc.listWorkflows('w1', {}, 'u1');
    expect(wf!.usedBy.projects).toEqual([{ id: 'p1', key: 'WM', name: 'Website', deleted: false }]);
    expect(wf!.hiddenCount).toBe(1);
    expect(JSON.stringify(wf)).not.toContain('HR');
    expect(prisma.project.findMany.mock.calls[0]![0]).toMatchObject({ where: { ...visible } });
    expect(prisma.project.groupBy.mock.calls[0]![0]).toMatchObject({ where: { NOT: visible } });
  });

  it('thấy hết (admin): không groupBy, hiddenCount = 0', async () => {
    const { svc, prisma } = build({});
    const [wf] = await svc.listWorkflows('w1', {}, 'u1');
    expect(wf!.hiddenCount).toBe(0);
    expect(prisma.project.groupBy).not.toHaveBeenCalled();
  });

  it('listWorkflows: quy trình của dự án ẩn bị loại (OR [chung, dự án thấy được])', async () => {
    const { svc, prisma } = build(visible);
    await svc.listWorkflows('w1', {}, 'u1');
    expect(prisma.workflow.findMany.mock.calls[0]![0]).toMatchObject({
      where: { organizationId: 'w1', OR: [{ projectId: null }, { project: visible }] },
    });
  });

  it('listWorkflows: mặc định loại quy trình của dự án đã xoá mềm (mẫu giữ nguyên); includeTrashed thì không loại', async () => {
    const a = build({});
    await a.svc.listWorkflows('w1', {}, 'u1');
    expect(a.prisma.workflow.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        organizationId: 'w1',
        AND: [{ OR: [{ projectId: null }, { project: { deletedAt: null } }] }],
      },
    });
    const b = build({});
    await b.svc.listWorkflows('w1', { includeTrashed: true }, 'u1');
    expect(
      (b.prisma.workflow.findMany.mock.calls[0]![0] as { where: object }).where,
    ).not.toHaveProperty('AND');
  });

  it('getWorkflow quy trình của dự án ẩn → 404; thành viên thấy', async () => {
    const hiddenOne = build(visible);
    hiddenOne.prisma.workflow.findFirst.mockResolvedValueOnce(null as never);
    await expect(hiddenOne.svc.getWorkflow('w1', 'wfHR', 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(hiddenOne.prisma.workflow.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'wfHR', organizationId: 'w1', OR: [{ projectId: null }, { project: visible }] },
    });
    const member = build(visible);
    await expect(member.svc.getWorkflow('w1', 'tpl', 'u1')).resolves.toMatchObject({ id: 'tpl' });
  });
});

describe('WorkflowAdminService — quy trình theo loại việc: usedBy, WORKFLOW_IN_USE, STATUS_HAS_ISSUES', () => {
  const wfRow = (id: string) => ({
    id,
    organizationId: 'w1',
    projectId: null,
    name: id,
    description: null,
    isTemplate: false,
    isDefault: false,
    sourceTemplateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    statuses: [],
    transitions: [],
  });

  it('GET /workflows: usedBy gồm loại việc của tổ chức (scheme), ghi đè của dự án (overrides) và dự án dùng mặc định (projects)', async () => {
    const prisma = {
      workflow: { findMany: vi.fn(() => Promise.resolve([wfRow('wfBug')])) },
      organizationWorkflowScheme: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { workflowId: 'wfBug', issueType: { key: 'BUG', name: 'Bug' } },
            { workflowId: 'wfBug', issueType: { key: null, name: 'Lỗi giao diện' } },
          ]),
        ),
      },
      projectWorkflowOverride: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { workflowId: 'wfBug', project: { key: 'KY' }, issueType: { key: 'BUG', name: 'Bug' } },
          ]),
        ),
      },
      project: { findMany: vi.fn(() => Promise.resolve([])) },
    };
    const out = await new WorkflowAdminService(prisma as never, ALL_ACCESS as never).listWorkflows(
      'w1',
      {},
      'u1',
    );
    expect(out[0]!.usedBy).toEqual({
      scheme: ['BUG', 'Lỗi giao diện'],
      overrides: [{ projectKey: 'KY', typeKey: 'BUG' }],
      projects: [],
      hiddenOverrideCount: 0,
    });
  });

  it('dự án riêng tư người xem không thấy: ghi đè bị lọc và chỉ đếm hiddenOverrideCount (không lộ mã)', async () => {
    const visible = { OR: [{ isPrivate: false }] };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visible)) };
    const prisma = {
      workflow: { findMany: vi.fn(() => Promise.resolve([wfRow('wfBug')])) },
      organizationWorkflowScheme: { findMany: vi.fn(() => Promise.resolve([])) },
      projectWorkflowOverride: {
        findMany: vi.fn((..._a: unknown[]) => Promise.resolve([])),
        groupBy: vi.fn((..._a: unknown[]) =>
          Promise.resolve([{ workflowId: 'wfBug', _count: { _all: 2 } }]),
        ),
      },
      project: {
        findMany: vi.fn(() => Promise.resolve([])),
        groupBy: vi.fn(() => Promise.resolve([])),
      },
    };
    const [wf] = await new WorkflowAdminService(prisma as never, access as never).listWorkflows(
      'w1',
      {},
      'u1',
    );
    expect(wf!.usedBy.overrides).toEqual([]);
    expect(wf!.usedBy.hiddenOverrideCount).toBe(2);
    expect(prisma.projectWorkflowOverride.findMany.mock.calls[0]![0]).toMatchObject({
      where: { project: { organizationId: 'w1', ...visible } },
    });
    expect(prisma.projectWorkflowOverride.groupBy.mock.calls[0]![0]).toMatchObject({
      where: { project: { organizationId: 'w1', NOT: visible } },
    });
  });

  it('removeWorkflow: đang gán cho loại việc của tổ chức => 409 WORKFLOW_IN_USE nêu loại việc, không xoá', async () => {
    const { service, prisma } = make({ projectId: null });
    prisma.organizationWorkflowScheme.findMany.mockResolvedValueOnce([
      { issueType: { key: 'BUG', name: 'Bug' } },
    ] as never);
    const err = await service.removeWorkflow('w1', 'wf1').catch((e: unknown) => e);
    expect(err).toMatchObject({
      status: 409,
      code: 'WORKFLOW_IN_USE',
      message: expect.stringContaining('BUG') as unknown,
    });
    expect(prisma.workflow.delete).not.toHaveBeenCalled();
  });

  it('removeWorkflow: là ghi đè của dự án => 409 WORKFLOW_IN_USE nêu mã dự án, không xoá', async () => {
    const { service, prisma } = make({ projectId: null });
    prisma.projectWorkflowOverride.findMany.mockResolvedValueOnce([
      { project: { key: 'KY' }, issueType: { key: 'BUG', name: 'Bug' } },
    ] as never);
    const err = await service.removeWorkflow('w1', 'wf1').catch((e: unknown) => e);
    expect(err).toMatchObject({
      status: 409,
      code: 'WORKFLOW_IN_USE',
      message: expect.stringContaining('KY') as unknown,
    });
    expect(prisma.workflow.delete).not.toHaveBeenCalled();
  });

  it('removeWorkflow: Postgres RESTRICT (23001) do gán đồng thời => 409 WORKFLOW_IN_USE thay vì 500', async () => {
    const { service, prisma } = make({ projectId: null });
    prisma.workflow.delete.mockRejectedValueOnce(
      new PrismaErrors.PrismaClientUnknownRequestError(
        'violates RESTRICT setting of foreign key (23001)',
        {
          clientVersion: 'x',
        },
      ),
    );
    await expect(service.removeWorkflow('w1', 'wf1')).rejects.toMatchObject({
      status: 409,
      code: 'WORKFLOW_IN_USE',
    });
  });
});

type Loose = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
type Strict = Loose &
  Record<'status' | 'issue' | 'issueHistory', Record<string, ReturnType<typeof vi.fn>>>;
function withIssues(count: number) {
  const m = make({ projectId: null });
  m.prisma.issue.count.mockResolvedValue(count);
  const p = m.prisma as unknown as Loose;
  p.issue!.findMany = vi.fn(() =>
    Promise.resolve([
      { id: 'i1', projectId: 'p1', sprintId: null, resolutionId: null },
      { id: 'i2', projectId: 'p1', sprintId: null, resolutionId: null },
    ]),
  );
  p.issue!.updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
  p.issueHistory = { createMany: vi.fn(() => Promise.resolve({ count: 2 })) };
  p.resolution = { findFirst: vi.fn(() => Promise.resolve({ id: 'r-def' })) };
  p.status!.findUniqueOrThrow = vi.fn(() =>
    Promise.resolve({ id: 's1', name: 'Cũ', category: 'IN_PROGRESS' }),
  );
  p.status!.findFirst = vi.fn((a: { where: { id: string; workflowId?: string } }) =>
    a.where.workflowId
      ? // tra trạng thái thay thế: chỉ `sNew` thuộc quy trình wf1
        Promise.resolve(
          a.where.id === 'sNew' ? { id: 'sNew', name: 'Mới', category: 'IN_PROGRESS' } : null,
        )
      : // requireStatus
        Promise.resolve({ id: 's1', workflowId: 'wf1', workflow: { projectId: null } }),
  );
  return { service: m.service, prisma: p as Strict };
}

describe('WorkflowAdminService.removeStatus (STATUS_HAS_ISSUES)', () => {
  it('còn việc mà không có replacementStatusId => 409 STATUS_HAS_ISSUES, không xoá, không chuyển', async () => {
    const { service, prisma } = withIssues(2);
    const err = await service.removeStatus('w1', 'u1', 's1').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: 'STATUS_HAS_ISSUES' });
    expect(prisma.status.delete).not.toHaveBeenCalled();
    expect(prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('có replacementStatusId (cùng quy trình): chuyển hết việc (version + lịch sử) rồi xoá, một transaction', async () => {
    const { service, prisma } = withIssues(2);
    const out = await service.removeStatus('w1', 'u1', 's1', 'sNew');
    expect(out).toEqual({ success: true, moved: 2 });
    expect(prisma.issue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['i1', 'i2'] } },
        data: expect.objectContaining({ statusId: 'sNew', version: { increment: 1 } }) as unknown,
      }),
    );
    expect(prisma.issueHistory.createMany).toHaveBeenCalledTimes(1);
    expect(
      (
        prisma.issueHistory.createMany!.mock.calls[0] as unknown as [
          { data: Array<{ actorId: string }> },
        ]
      )[0].data.every((h) => h.actorId === 'SYS'),
    ).toBe(true);
    expect(prisma.status.delete).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('replacementStatusId không thuộc quy trình / chính nó => 422, không xoá', async () => {
    const { service, prisma } = withIssues(2);
    await expect(service.removeStatus('w1', 'u1', 's1', 'sOther')).rejects.toMatchObject({
      status: 422,
    });
    const self = withIssues(2);
    await expect(self.service.removeStatus('w1', 'u1', 's1', 's1')).rejects.toMatchObject({
      status: 422,
    });
    expect(prisma.status.delete).not.toHaveBeenCalled();
    expect(self.prisma.status.delete).not.toHaveBeenCalled();
  });

  it('(M1/L2) có thay thế: quy tắc nhắc trạng thái bị xoá được sửa sang trạng thái thay thế, trong cùng transaction đã khoá', async () => {
    const m = make({
      projectId: null,
      rules: [{ id: 'r1', name: 'R', triggerConfig: { toStatusId: 's1' } }],
    });
    const order: string[] = [];
    m.prisma.$executeRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve(0);
    });
    m.prisma.status.delete.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve({});
    });
    m.prisma.automationRule.update.mockImplementation(
      (a: { where: { id: string }; data: Record<string, unknown> }) => {
        order.push('rule');
        Object.assign(m.rules.find((r) => r.id === a.where.id)!, a.data);
        return Promise.resolve({});
      },
    );
    (m.prisma.issue.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    await m.service.removeStatus('w1', 'u1', 's1', 'sNew');
    expect(order).toEqual(['lock', 'rule', 'delete']);
    expect(m.rules[0]!.triggerConfig).toEqual({ toStatusId: 'sNew' });
    expect(m.published).toEqual([]); // chỉ sửa id, không tắt → không báo
    expect(m.events.emit).toHaveBeenCalledWith('automation.rules_changed', {
      organizationId: 'w1',
    });
    expect(m.resolver.invalidate).toHaveBeenCalled();
  });

  it('(M1) xoá không có thay thế (không còn việc): quy tắc nhắc nó bị TẮT và người tạo được báo SAU khi xoá; xoá lỗi thì không tắt/báo', async () => {
    const m = make({
      projectId: null,
      rules: [{ id: 'r1', name: 'Khi xong', triggerConfig: { toStatusId: 's1' } }],
    });
    await m.service.removeStatus('w1', 'u1', 's1');
    expect(m.rules[0]!.enabled).toBe(false);
    expect(m.published).toEqual([
      expect.objectContaining({
        recipientId: 'u-rule',
        force: true,
        payload: { automationRuleDisabled: 'Khi xong' },
      }),
    ]);
    const bad = make({
      projectId: null,
      rules: [{ id: 'r1', name: 'Khi xong', triggerConfig: { toStatusId: 's1' } }],
    });
    bad.prisma.status.delete.mockRejectedValue(new Error('boom'));
    await expect(bad.service.removeStatus('w1', 'u1', 's1')).rejects.toThrow('boom');
    expect(bad.published).toEqual([]);
    expect(bad.events.emit).not.toHaveBeenCalled();
  });

  it('(L3) trạng thái ban đầu của quy trình đang được tổ chức/dự án dùng => 409 INITIAL_STATUS_IN_USE, không xoá; không dùng thì xoá được', async () => {
    const initial = {
      id: 's1',
      workflowId: 'wf1',
      isInitial: true,
      workflow: { projectId: null },
    };
    const usedByScheme = make({ projectId: null });
    usedByScheme.prisma.status.findFirst.mockResolvedValue(initial as never);
    usedByScheme.prisma.organizationWorkflowScheme.count.mockResolvedValue(1);
    await expect(usedByScheme.service.removeStatus('w1', 'u1', 's1')).rejects.toMatchObject({
      status: 409,
      code: 'INITIAL_STATUS_IN_USE',
    });
    expect(usedByScheme.prisma.status.delete).not.toHaveBeenCalled();

    const usedByOverride = make({ projectId: null });
    usedByOverride.prisma.status.findFirst.mockResolvedValue(initial as never);
    usedByOverride.prisma.projectWorkflowOverride.count.mockResolvedValue(1);
    await expect(usedByOverride.service.removeStatus('w1', 'u1', 's1')).rejects.toMatchObject({
      status: 409,
      code: 'INITIAL_STATUS_IN_USE',
    });

    const free = make({ projectId: null });
    free.prisma.status.findFirst.mockResolvedValue(initial as never);
    expect(await free.service.removeStatus('w1', 'u1', 's1')).toEqual({
      success: true,
      moved: 0,
    });
  });

  it('không còn việc => xoá thẳng, không cần thay thế, không chuyển gì', async () => {
    const { service, prisma } = withIssues(0);
    expect(await service.removeStatus('w1', 'u1', 's1')).toEqual({ success: true, moved: 0 });
    expect(prisma.issue.updateMany).not.toHaveBeenCalled();
    expect(prisma.status.delete).toHaveBeenCalledTimes(1);
  });
});
