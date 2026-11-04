import { describe, expect, it, vi } from 'vitest';
import { requestContext } from '../../common/context/request-context';
import { WorkflowResolver } from './workflow-resolver.service';

interface Data {
  project?: { workspaceId: string; defaultWorkflowId: string | null } | null;
  overrides?: { issueTypeId: string; workflowId: string }[];
  schemes?: { issueTypeId: string; workflowId: string }[];
  types?: { id: string }[];
}

/** Prisma giả đủ cho resolver; mọi lời gọi đếm được để kiểm cache. */
function makeTx(d: Data) {
  const project =
    d.project === undefined ? { workspaceId: 'w1', defaultWorkflowId: 'wfDef' } : d.project;
  return {
    project: { findUnique: vi.fn(() => Promise.resolve(project)) },
    projectWorkflowOverride: {
      findMany: vi.fn(() => Promise.resolve(d.overrides ?? [])),
    },
    workspaceWorkflowScheme: {
      findMany: vi.fn(() => Promise.resolve(d.schemes ?? [])),
    },
    issueType: { findMany: vi.fn(() => Promise.resolve(d.types ?? [])) },
  };
}
type Tx = Parameters<WorkflowResolver['forIssue']>[0];
const asTx = (t: ReturnType<typeof makeTx>) => t as unknown as Tx;
const inRequest = <T>(fn: () => Promise<T>) => requestContext.run({ requestId: 'r1' }, fn);

describe('WorkflowResolver.forIssue', () => {
  it('ghi đè của dự án thắng quy trình workspace và mặc định', async () => {
    const tx = makeTx({
      overrides: [{ issueTypeId: 'tBug', workflowId: 'wfOverride' }],
      schemes: [{ issueTypeId: 'tBug', workflowId: 'wfScheme' }],
    });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({
      workflowId: 'wfOverride',
    });
  });

  it('không có ghi đè → dùng quy trình workspace', async () => {
    const tx = makeTx({
      overrides: [{ issueTypeId: 'tOther', workflowId: 'wfOverride' }],
      schemes: [{ issueTypeId: 'tBug', workflowId: 'wfScheme' }],
    });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: 'wfScheme' });
  });

  it('không có workspace scheme → rơi về Project.defaultWorkflowId', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: 'wfDef' });
  });

  it('không có gì cả (defaultWorkflowId null) → workflowId rỗng như code cũ', async () => {
    const tx = makeTx({ project: { workspaceId: 'w1', defaultWorkflowId: null } });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: '' });
  });

  it('dự án không tồn tại → 404', async () => {
    const tx = makeTx({ project: null });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'pX', 'tBug')).rejects.toMatchObject({ status: 404 });
  });

  it('tra theo đúng dự án và workspace của dự án', async () => {
    const tx = makeTx({});
    await new WorkflowResolver().forIssue(asTx(tx), 'p1', 'tBug');
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' } }),
    );
    expect(tx.workspaceWorkflowScheme.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1' } }),
    );
  });
});

describe('WorkflowResolver cache theo request', () => {
  it('trong một request: lần 2 dùng lại kết quả, không chạm DB', async () => {
    const tx = makeTx({ schemes: [{ issueTypeId: 'tBug', workflowId: 'wfScheme' }] });
    const r = new WorkflowResolver();
    await inRequest(async () => {
      const a = await r.forIssue(asTx(tx), 'p1', 'tBug');
      const callsAfterFirst = tx.project.findUnique.mock.calls.length;
      const b = await r.forIssue(asTx(tx), 'p1', 'tBug');
      const c = await r.forIssue(asTx(tx), 'p1', 'tTask');
      expect(b).toEqual(a);
      expect(c).toEqual({ workflowId: 'wfDef' });
      // tBug lần 2 + tTask đều suy ra từ cùng bản đã nạp của dự án p1.
      expect(tx.project.findUnique.mock.calls.length).toBe(callsAfterFirst);
      expect(tx.workspaceWorkflowScheme.findMany).toHaveBeenCalledTimes(1);
      expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(1);
    });
  });

  it('request khác nhau không dùng chung cache', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await inRequest(() => r.forIssue(asTx(tx), 'p1', 'tBug'));
    await inRequest(() => r.forIssue(asTx(tx), 'p1', 'tBug'));
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(2);
  });

  it('ngoài request (worker/script) không cache', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await r.forIssue(asTx(tx), 'p1', 'tBug');
    await r.forIssue(asTx(tx), 'p1', 'tBug');
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidate(projectId) bỏ cache để thấy thay đổi cùng request', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await inRequest(async () => {
      await r.forIssue(asTx(tx), 'p1', 'tBug');
      r.invalidate('p1');
      await r.forIssue(asTx(tx), 'p1', 'tBug');
      expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(2);
    });
  });
});

describe('WorkflowResolver.forProject', () => {
  it('trả Map loại việc → quy trình với thứ tự ghi đè > workspace > mặc định', async () => {
    const tx = makeTx({
      types: [{ id: 'tTask' }, { id: 'tBug' }, { id: 'tEpic' }],
      overrides: [{ issueTypeId: 'tEpic', workflowId: 'wfEpicOv' }],
      schemes: [
        { issueTypeId: 'tBug', workflowId: 'wfBug' },
        { issueTypeId: 'tEpic', workflowId: 'wfEpic' },
      ],
    });
    const m = await new WorkflowResolver().forProject(asTx(tx), 'p1');
    expect(Object.fromEntries(m)).toEqual({
      tTask: 'wfDef',
      tBug: 'wfBug',
      tEpic: 'wfEpicOv',
    });
    expect(tx.issueType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1' } }),
    );
  });

  it('không có quy trình mặc định và không có scheme → loại việc đó vắng mặt trong Map', async () => {
    const tx = makeTx({
      project: { workspaceId: 'w1', defaultWorkflowId: null },
      types: [{ id: 'tTask' }, { id: 'tBug' }],
      schemes: [{ issueTypeId: 'tBug', workflowId: 'wfBug' }],
    });
    const m = await new WorkflowResolver().forProject(asTx(tx), 'p1');
    expect(Object.fromEntries(m)).toEqual({ tBug: 'wfBug' });
  });

  it('cache theo request: forIssue sau forProject không chạm DB', async () => {
    const tx = makeTx({
      types: [{ id: 'tBug' }],
      schemes: [{ issueTypeId: 'tBug', workflowId: 'wfBug' }],
    });
    const r = new WorkflowResolver();
    await inRequest(async () => {
      await r.forProject(asTx(tx), 'p1');
      await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: 'wfBug' });
      expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
