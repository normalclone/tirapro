import { describe, expect, it, vi } from 'vitest';
import { requestContext } from '../../common/context/request-context';
import { WorkflowResolver, runWithWorkflowMemo } from './workflow-resolver.service';

interface Data {
  project?: { organizationId: string; defaultWorkflowId: string | null } | null;
  overrides?: { issueTypeId: string; workflowId: string }[];
  schemes?: { issueTypeId: string; workflowId: string }[];
  types?: { id: string }[];
}

/** Prisma giả đủ cho resolver; mọi lời gọi đếm được để kiểm cache. */
function makeTx(d: Data) {
  const project =
    d.project === undefined ? { organizationId: 'w1', defaultWorkflowId: 'wfDef' } : d.project;
  return {
    project: { findUnique: vi.fn(() => Promise.resolve(project)) },
    projectWorkflowOverride: {
      findMany: vi.fn(() => Promise.resolve(d.overrides ?? [])),
    },
    organizationWorkflowScheme: {
      findMany: vi.fn(() => Promise.resolve(d.schemes ?? [])),
    },
    issueType: { findMany: vi.fn(() => Promise.resolve(d.types ?? [])) },
  };
}
type Tx = Parameters<WorkflowResolver['forIssue']>[0];
const asTx = (t: ReturnType<typeof makeTx>) => t as unknown as Tx;
const inRequest = <T>(fn: () => Promise<T>) => requestContext.run({ requestId: 'r1' }, fn);

describe('WorkflowResolver.forIssue', () => {
  it('ghi đè của dự án thắng quy trình organization và mặc định', async () => {
    const tx = makeTx({
      overrides: [{ issueTypeId: 'tBug', workflowId: 'wfOverride' }],
      schemes: [{ issueTypeId: 'tBug', workflowId: 'wfScheme' }],
    });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({
      workflowId: 'wfOverride',
    });
  });

  it('không có ghi đè → dùng quy trình organization', async () => {
    const tx = makeTx({
      overrides: [{ issueTypeId: 'tOther', workflowId: 'wfOverride' }],
      schemes: [{ issueTypeId: 'tBug', workflowId: 'wfScheme' }],
    });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: 'wfScheme' });
  });

  it('không có organization scheme → rơi về Project.defaultWorkflowId', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: 'wfDef' });
  });

  it('không có gì cả (defaultWorkflowId null) → workflowId rỗng như code cũ', async () => {
    const tx = makeTx({ project: { organizationId: 'w1', defaultWorkflowId: null } });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: '' });
  });

  it('dự án không tồn tại → 404', async () => {
    const tx = makeTx({ project: null });
    const r = new WorkflowResolver();
    await expect(r.forIssue(asTx(tx), 'pX', 'tBug')).rejects.toMatchObject({ status: 404 });
  });

  it('tra theo đúng dự án và organization của dự án', async () => {
    const tx = makeTx({});
    await new WorkflowResolver().forIssue(asTx(tx), 'p1', 'tBug');
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' } }),
    );
    expect(tx.organizationWorkflowScheme.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'w1' } }),
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
      expect(tx.organizationWorkflowScheme.findMany).toHaveBeenCalledTimes(1);
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
  it('trả Map loại việc → quy trình với thứ tự ghi đè > organization > mặc định', async () => {
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
      expect.objectContaining({ where: { organizationId: 'w1' } }),
    );
  });

  it('không có quy trình mặc định và không có scheme → loại việc đó vắng mặt trong Map', async () => {
    const tx = makeTx({
      project: { organizationId: 'w1', defaultWorkflowId: null },
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

describe('WorkflowResolver — lỗi và invalidate', () => {
  it('lần nạp thất bại không bị nhớ: lần gọi sau trong cùng request thử lại và thành công', async () => {
    const tx = makeTx({});
    tx.projectWorkflowOverride.findMany
      .mockRejectedValueOnce(new Error('db tạm lỗi'))
      .mockResolvedValue([] as never);
    const r = new WorkflowResolver();
    await inRequest(async () => {
      await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).rejects.toThrow('db tạm lỗi');
      await expect(r.forIssue(asTx(tx), 'p1', 'tBug')).resolves.toEqual({ workflowId: 'wfDef' });
      expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(2);
    });
  });

  it('invalidate() không đối số bỏ cache của MỌI dự án trong request', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await inRequest(async () => {
      await r.forIssue(asTx(tx), 'p1', 'tBug');
      await r.forIssue(asTx(tx), 'p2', 'tBug');
      expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(2);
      r.invalidate();
      await r.forIssue(asTx(tx), 'p1', 'tBug');
      await r.forIssue(asTx(tx), 'p2', 'tBug');
      expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(4);
    });
  });

  it('invalidate(p1) chỉ bỏ cache của p1, p2 còn nguyên', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await inRequest(async () => {
      await r.forIssue(asTx(tx), 'p1', 'tBug');
      await r.forIssue(asTx(tx), 'p2', 'tBug');
      r.invalidate('p1');
      await r.forIssue(asTx(tx), 'p1', 'tBug');
      await r.forIssue(asTx(tx), 'p2', 'tBug');
      expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(3);
    });
  });

  it('invalidate() ngoài request (không có store) là no-op, không ném lỗi', () => {
    const r = new WorkflowResolver();
    expect(() => r.invalidate()).not.toThrow();
    expect(() => r.invalidate('p1')).not.toThrow();
  });

  it('invalidate() trong request chưa nạp gì cũng không ném lỗi', async () => {
    const r = new WorkflowResolver();
    await inRequest(() => {
      expect(() => r.invalidate()).not.toThrow();
      return Promise.resolve();
    });
  });
});

describe('runWithWorkflowMemo — bộ nhớ theo lần chạy cho việc nền (không có RequestStore)', () => {
  it('nhiều lời gọi trong một lần chạy chỉ nạp cấu hình MỘT lần cho mỗi dự án', async () => {
    const tx = makeTx({ schemes: [{ issueTypeId: 'tBug', workflowId: 'wfBug' }] });
    const r = new WorkflowResolver();
    await runWithWorkflowMemo(async () => {
      for (let i = 0; i < 50; i++) await r.forIssue(asTx(tx), 'p1', i % 2 ? 'tBug' : 'tTask');
    });
    expect(tx.project.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(1);
    expect(tx.organizationWorkflowScheme.findMany).toHaveBeenCalledTimes(1);
  });

  it('hết lần chạy thì bỏ bộ nhớ: lần chạy sau nạp lại', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await runWithWorkflowMemo(() => r.forIssue(asTx(tx), 'p1', 'tBug'));
    await runWithWorkflowMemo(() => r.forIssue(asTx(tx), 'p1', 'tBug'));
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(2);
  });

  it('lồng nhau dùng chung bộ nhớ ngoài cùng; mọi instance resolver dùng chung', async () => {
    const tx = makeTx({});
    await runWithWorkflowMemo(async () => {
      await new WorkflowResolver().forIssue(asTx(tx), 'p1', 'tBug');
      await runWithWorkflowMemo(() => new WorkflowResolver().forIssue(asTx(tx), 'p1', 'tBug'));
    });
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(1);
  });

  it('invalidate() trong lần chạy bỏ bộ nhớ của lần chạy (thấy thay đổi cấu hình)', async () => {
    const tx = makeTx({});
    const r = new WorkflowResolver();
    await runWithWorkflowMemo(async () => {
      await r.forIssue(asTx(tx), 'p1', 'tBug');
      r.invalidate('p1');
      await r.forIssue(asTx(tx), 'p1', 'tBug');
    });
    expect(tx.projectWorkflowOverride.findMany).toHaveBeenCalledTimes(2);
  });
});
