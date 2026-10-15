import { describe, expect, it, vi } from 'vitest';
import { WorkflowAdminService } from './workflow-admin.service';

const ARCHIVED = 'Dự án đã lưu trữ — hãy khôi phục dự án trước khi thay đổi';

/** Prisma giả: workflow `wf1` thuộc dự án `p1` (hoặc cấp workspace khi `projectId = null`). */
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
    },
    issue: { count: vi.fn(() => Promise.resolve(0)) },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
  };
  const service = new WorkflowAdminService(prisma as never);
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
