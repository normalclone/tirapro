import { describe, expect, it, vi } from 'vitest';
import { WorkflowAdminService } from './workflow-admin.service';

const ARCHIVED = 'Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi';

/** Prisma giả: workflow `wf1` thuộc dự án `p1` (hoặc cấp workspace khi `projectId = null`). */
/** Người xem thấy mọi dự án (admin): visibleWhere = {}. */
const ALL_ACCESS = { visibleWhere: vi.fn(() => Promise.resolve({})) };

function make(opts: { projectId: string | null; archived?: boolean }) {
  const wfRow = {
    id: 'wf1',
    workspaceId: 'w1',
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
        Promise.resolve({ id: 'wf1', workspaceId: 'w1', projectId: opts.projectId }),
      ),
      create: vi.fn(() => Promise.resolve(wfRow)),
      update: vi.fn(() => Promise.resolve(wfRow)),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      delete: vi.fn(() => Promise.resolve({})),
    },
    status: {
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
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
  };
  const service = new WorkflowAdminService(prisma as never, ALL_ACCESS as never);
  return { service, prisma };
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
  ['removeStatus', (s) => s.removeStatus('w1', 's1'), (p) => [p.status.delete]],
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
    '%s: workflow cấp workspace (không có projectId) không bị chặn, không tra dự án',
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

  it('createWorkflow không gắn dự án (workflow cấp workspace) => không chặn', async () => {
    const { service, prisma } = make({ projectId: null, archived: true });
    await expect(service.createWorkflow('w1', { name: 'N' })).resolves.toBeDefined();
    expect(prisma.workflow.create).toHaveBeenCalled();
  });
});

describe('WorkflowAdminService.listWorkflows — usedBy', () => {
  const wfRow = (id: string) => ({
    id,
    workspaceId: 'w1',
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
    expect(out.find((w) => w.id === 'w1')!.usedBy).toEqual([
      { id: 'p1', key: 'WM', name: 'Website', deleted: false },
      { id: 'p2', key: 'OLD', name: 'Cũ', deleted: true },
    ]);
    expect(out.find((w) => w.id === 'w2')!.usedBy).toEqual([]);
    expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
  });

  it('getWorkflow cũng trả usedBy', async () => {
    const prisma = {
      workflow: { findFirst: vi.fn(() => Promise.resolve(wfRow('w1'))) },
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
    expect(out.usedBy).toEqual([{ id: 'p1', key: 'WM', name: 'Website', deleted: false }]);
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
    workspaceId: 'w1',
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
    expect(wf!.usedBy).toEqual([{ id: 'p1', key: 'WM', name: 'Website', deleted: false }]);
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
      where: { workspaceId: 'w1', OR: [{ projectId: null }, { project: visible }] },
    });
  });

  it('getWorkflow quy trình của dự án ẩn → 404; thành viên thấy', async () => {
    const hiddenOne = build(visible);
    hiddenOne.prisma.workflow.findFirst.mockResolvedValueOnce(null as never);
    await expect(hiddenOne.svc.getWorkflow('w1', 'wfHR', 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(hiddenOne.prisma.workflow.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'wfHR', workspaceId: 'w1', OR: [{ projectId: null }, { project: visible }] },
    });
    const member = build(visible);
    await expect(member.svc.getWorkflow('w1', 'tpl', 'u1')).resolves.toMatchObject({ id: 'tpl' });
  });
});
