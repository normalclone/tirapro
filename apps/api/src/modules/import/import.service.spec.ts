import { describe, expect, it, vi } from 'vitest';
import { ImportService } from './import.service';
import { IssuesService } from '../issues/issues.service';

function setup(failSummary?: string, members: Array<{ id: string; email: string }> = []) {
  const tx = {};
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    importJob: {
      create: vi.fn(() => Promise.resolve({ id: 'job1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    issueType: { findMany: vi.fn(() => Promise.resolve([{ id: 't1', name: 'Task' }])) },
    priority: { findMany: vi.fn(() => Promise.resolve([])) },
    label: { findMany: vi.fn(() => Promise.resolve([])) },
    user: { findMany: vi.fn(() => Promise.resolve(members)) },
  };
  const issues = {
    createWithin: vi.fn(
      async (
        _tx: unknown,
        _w: string,
        _u: string,
        input: { summary: string; assigneeId?: string },
      ) => {
        await Promise.resolve();
        if (input.summary === failSummary) throw new Error('lỗi DB giả lập');
        return { id: `id-${input.summary}` };
      },
    ),
    emitCreated: vi.fn(),
  };
  const service = new ImportService(prisma as never, issues as never);
  return { service, prisma, issues };
}

const csvOf = (n: number) =>
  ['summary', ...Array.from({ length: n }, (_, i) => `row${i}`)].join('\n');

describe('ImportService — ghi theo lô', () => {
  it('250 dòng => 3 transaction (100/100/50), sự kiện phát sau commit cho từng issue', async () => {
    const { service, prisma, issues } = setup();
    const res = await service.importCsv('w1', 'u1', { projectId: 'p1', csv: csvOf(250) });
    expect(res).toMatchObject({ created: 250, failed: 0, total: 250 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(issues.createWithin).toHaveBeenCalledTimes(250);
    expect(issues.emitCreated).toHaveBeenCalledTimes(250);
  });

  it('một dòng lỗi => lô đó rollback, chạy lại từng dòng, chỉ dòng lỗi bị báo; không emit cho dòng đã rollback', async () => {
    const { service, prisma, issues } = setup('row150');
    const res = await service.importCsv('w1', 'u1', { projectId: 'p1', csv: csvOf(250) });
    expect(res.created).toBe(249);
    expect(res.failed).toBe(1);
    expect(res.errors).toEqual([{ row: 150, error: 'lỗi DB giả lập' }]);
    // lô 1 + lô 2 (lỗi) + 100 lần chạy lại từng dòng + lô 3
    expect(prisma.$transaction).toHaveBeenCalledTimes(103);
    expect(issues.emitCreated).toHaveBeenCalledTimes(249);
  });
});

describe('ImportService.importJson — assignee chỉ là thành viên workspace', () => {
  it('chỉ nạp user thuộc workspace; email không phải thành viên => không có assignee, lô vẫn chạy', async () => {
    const { service, prisma, issues } = setup(undefined, [{ id: 'u2', email: 'Member@x.vn' }]);
    const res = await service.importJson('w1', 'u1', {
      projectId: 'p1',
      data: {
        issues: [
          { summary: 'a', assignee: 'member@x.vn' },
          { summary: 'b', assignee: 'outsider@other.vn' },
        ],
      },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceMemberships: { some: { workspaceId: 'w1' } } } }),
    );
    expect(res).toMatchObject({ created: 2, failed: 0 });
    const assignees = issues.createWithin.mock.calls.map((c) => c[3].assigneeId);
    expect(assignees).toEqual(['u2', undefined]);
  });

  it('FW2: assignee không khớp thành viên => đếm vào skippedAssignees (kết quả trả về + result của job); chỉ đếm dòng đã tạo được', async () => {
    const { service, prisma } = setup('c', [{ id: 'u2', email: 'member@x.vn' }]);
    const res = await service.importJson('w1', 'u1', {
      projectId: 'p1',
      data: {
        issues: [
          { summary: 'a', assignee: 'member@x.vn' },
          { summary: 'b', assignee: 'outsider@other.vn' },
          { summary: 'c', assignee: 'outsider2@other.vn' }, // dòng này lỗi khi ghi => không tính
          { summary: 'd', assignee: '  ' },
          { summary: 'e' },
        ],
      },
    });
    expect(res.skippedAssignees).toBe(1);
    const updateArg = (prisma.importJob.update.mock.calls as unknown[][]).at(-1)![0] as {
      data: { result: { skippedAssignees: number } };
    };
    expect(updateArg.data.result.skippedAssignees).toBe(1);
  });

  it('FW2: không có assignee nào bị bỏ => skippedAssignees = 0', async () => {
    const { service } = setup(undefined, [{ id: 'u2', email: 'member@x.vn' }]);
    const res = await service.importJson('w1', 'u1', {
      projectId: 'p1',
      data: { issues: [{ summary: 'a', assignee: 'member@x.vn' }, { summary: 'b' }] },
    });
    expect(res.skippedAssignees).toBe(0);
  });
});

describe('ImportService.createIssuesInChunks + IssuesService thật — sprint CLOSED của import Jira', () => {
  it('dòng gắn sprint CLOSED (do import Jira tạo) vẫn được tạo, không bị FW1 chặn 422', async () => {
    const createdRow = {
      id: 'i1',
      key: 'P-TASK-1',
      summary: 's',
      workspaceId: 'w1',
      projectId: 'p1',
      type: {
        id: 't1',
        name: 'Task',
        key: 'TASK',
        iconUrl: null,
        color: null,
        hierarchyLevel: 0,
        isSubtask: false,
      },
      status: {
        id: 's1',
        workflowId: 'wf',
        name: 'Todo',
        category: 'TODO',
        color: null,
        order: 0,
        isInitial: true,
      },
      statusId: 's1',
      sprintId: 'sp-closed',
      labels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      project: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            id: 'p1',
            key: 'P',
            defaultWorkflowId: 'wf',
            leadId: null,
            defaultAssigneeMode: 'NONE',
            archivedAt: null,
          }),
        ),
        update: vi.fn(() => Promise.resolve({ issueSequence: 1 })),
      },
      issueType: {
        findFirst: vi.fn(() => Promise.resolve({ id: 't1' })),
        findUnique: vi.fn(() => Promise.resolve({ key: 'TASK', name: 'Task' })),
      },
      sprint: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'sp-closed', state: 'CLOSED' })),
      },
      status: { findFirst: vi.fn(() => Promise.resolve({ id: 's1', category: 'TODO' })) },
      priority: { findFirst: vi.fn(() => Promise.resolve(null)) },
      issue: {
        findFirst: vi.fn(() => Promise.resolve(null)),
        count: vi.fn(() => Promise.resolve(0)),
        create: vi.fn(() => Promise.resolve(createdRow)),
      },
      issueHistory: { create: vi.fn() },
    };
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx), ...tx };
    const issues = new IssuesService(prisma as never, { emit: vi.fn() } as never, {} as never);
    const service = new ImportService(prisma as never, issues);
    const res = await service.createIssuesInChunks(
      'w1',
      'u1',
      [
        {
          row: 0,
          input: {
            projectId: 'p1',
            typeId: 't1',
            summary: 's',
            descriptionFormat: 'MARKDOWN',
            sprintId: 'sp-closed',
          },
        },
      ],
      new Map(),
    );
    expect(res).toMatchObject({ created: 1, errors: [] });
    expect(tx.issue.create).toHaveBeenCalledTimes(1);
  });
});

describe('ImportService.importJson — skippedAssignees khi lô lỗi rồi chạy lại từng dòng', () => {
  it('không đếm đôi: dòng thành công sau khi lô rollback chỉ đếm một lần, dòng lỗi không đếm', async () => {
    const { service } = setup('bad', [{ id: 'u2', email: 'member@x.vn' }]);
    const res = await service.importJson('w1', 'u1', {
      projectId: 'p1',
      data: {
        issues: [
          { summary: 'ok1', assignee: 'ghost1@x.vn' },
          { summary: 'bad', assignee: 'ghost2@x.vn' }, // làm cả lô rollback rồi bị cô lập
          { summary: 'ok2', assignee: 'ghost3@x.vn' },
          { summary: 'ok3', assignee: 'member@x.vn' },
        ],
      },
    });
    expect(res).toMatchObject({ created: 3, failed: 1 });
    expect(res.skippedAssignees).toBe(2); // ok1 + ok2, mỗi dòng đúng một lần
  });
});
