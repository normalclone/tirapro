// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';
import { mk } from '@/lib/issueFixture';
import {
  bulkStatusOptions,
  commonNextStatuses,
  groupByDestination,
  statusUndoPlan,
} from './bulkEdit';

type BulkBody = { items: Array<{ id: string; version: number }>; patch: { statusId: string } };
const h = vi.hoisted(() => ({
  patch: vi.fn<(url: string, body: BulkBody) => Promise<unknown>>(),
}));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { patch: h.patch, get: vi.fn() } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { useBulkEdit } from './useBulkEdit';

const std = defaultWorkflow('STANDARD');
const bug = defaultWorkflow('BUG');
const workflows = [std, bug];

const issue = (id: string, key: 'STANDARD' | 'BUG', statusName: string): IssueDto => {
  const wf = key === 'BUG' ? bug : std;
  const s = wf.statuses.find((x) => x.name === statusName)!;
  return mk(id, { projectId: 'p1', version: 3, status: { ...s, workflowId: wf.id } });
};

// 2 Task đang In Review, 2 Bug đang Ready for Retest — cùng một dự án.
const t1 = issue('t1', 'STANDARD', 'In Review');
const t2 = issue('t2', 'STANDARD', 'In Review');
const b1 = issue('b1', 'BUG', 'Ready for Retest');
const b2 = issue('b2', 'BUG', 'Ready for Retest');
const mixed = [t1, t2, b1, b2];

describe('bulkStatusOptions — lô chỉ một quy trình', () => {
  it('Task + Task: đúng bước chung như trước (id là id trạng thái, mọi việc đều có đích)', () => {
    const opts = bulkStatusOptions(workflows, [t1, t2]);
    expect(opts.map((o) => o.id)).toEqual(commonNextStatuses(workflows, [t1, t2]).map((o) => o.id));
    const done = opts.find((o) => o.name === 'Done')!;
    expect(done.targets).toEqual({
      t1: statusIdOf('STANDARD', 'Done'),
      t2: statusIdOf('STANDARD', 'Done'),
    });
    expect(done.group).toBeUndefined();
  });
  it('không có việc nào / trạng thái lạ → không có lựa chọn', () => {
    expect(bulkStatusOptions(workflows, [])).toEqual([]);
    expect(bulkStatusOptions([], [t1])).toEqual([]);
  });
});

describe('bulkStatusOptions — lô trộn Task (Standard) + Bug', () => {
  const opts = bulkStatusOptions(workflows, mixed);

  it('trước kia giao theo id cho rỗng; nay có lựa chọn', () => {
    expect(commonNextStatuses(workflows, mixed)).toEqual([]);
    expect(opts.length).toBeGreaterThan(0);
  });
  it('"Done" cùng tên ở cả hai quy trình: một lựa chọn, mỗi việc về Done của quy trình mình', () => {
    const done = opts.find((o) => o.id === 'name:done')!;
    expect(done.group).toBe('Cùng tên ở nhiều quy trình');
    // Mọi việc đều đổi được → không có dòng phụ gây hiểu nhầm "chỉ …".
    expect(done.hint).toBeUndefined();
    expect(done.targets).toEqual({
      t1: statusIdOf('STANDARD', 'Done'),
      t2: statusIdOf('STANDARD', 'Done'),
      b1: statusIdOf('BUG', 'Done'),
      b2: statusIdOf('BUG', 'Done'),
    });
  });
  it('trạng thái chỉ một quy trình có (Rework / Reopened) nằm ở nhóm của quy trình đó, chỉ nhóm đó đổi', () => {
    const rework = opts.find((o) => o.name === 'Rework')!;
    expect(rework.group).toBe('Standard Workflow — 2 việc');
    expect(rework.targets).toEqual({
      t1: statusIdOf('STANDARD', 'Rework'),
      t2: statusIdOf('STANDARD', 'Rework'),
    });
    const reopened = opts.find((o) => o.name === 'Reopened')!;
    expect(reopened.group).toBe('Bug Workflow — 2 việc');
    expect(Object.keys(reopened.targets).sort()).toEqual(['b1', 'b2']);
    expect(opts.some((o) => o.name === 'Reopened' && o.targets.t1)).toBe(false);
  });
  it('lựa chọn "cùng tên" đứng trước các nhóm quy trình (các nhóm liền nhau để tiêu đề không lặp)', () => {
    const groups = opts.map((o) => o.group);
    const collapsed = groups.filter((g, i) => g !== groups[i - 1]);
    expect(new Set(collapsed).size).toBe(collapsed.length);
    expect(collapsed[0]).toBe('Cùng tên ở nhiều quy trình');
  });
  it('groupByDestination: mỗi quy trình một đích (hai request)', () => {
    const done = opts.find((o) => o.id === 'name:done')!;
    const g = groupByDestination(done, mixed);
    expect(g.map((x) => [x.statusId, x.issues.map((i) => i.id)])).toEqual([
      [statusIdOf('STANDARD', 'Done'), ['t1', 't2']],
      [statusIdOf('BUG', 'Done'), ['b1', 'b2']],
    ]);
  });
  it('việc ở bước chỉ một nhóm đi được thì các việc kia không có đích (bị bỏ qua)', () => {
    const lot = [t1, issue('b3', 'BUG', 'In Progress')];
    const o = bulkStatusOptions(workflows, lot);
    const retest = o.find((x) => x.name === 'Ready for Retest')!;
    expect(retest.targets).toEqual({ b3: statusIdOf('BUG', 'Ready for Retest') });
  });
  it('cùng tên nhưng chỉ một phần việc có bước → dòng phụ nêu số việc (Epic đang In Progress chưa đi thẳng tới Done)', () => {
    const epic = defaultWorkflow('EPIC');
    const e1: IssueDto = mk('e1', {
      projectId: 'p1',
      version: 3,
      status: { ...epic.statuses.find((x) => x.name === 'In Progress')!, workflowId: epic.id },
    });
    const o = bulkStatusOptions([std, bug, epic], [...mixed, e1]);
    const done = o.find((x) => o.length > 0 && x.id === 'name:done')!;
    expect(done.hint).toBe('Chỉ 4/5 việc có bước chuyển này');
    expect(Object.keys(done.targets)).not.toContain('e1');
  });
  it('Hoàn tác chỉ khi quy trình cho phép bước ngược ở MỌI nhóm', () => {
    const done = opts.find((o) => o.id === 'name:done')!;
    // Standard: Done → In Review không có bước (không hứa Hoàn tác).
    expect(
      statusUndoPlan(
        workflows,
        done,
        mixed,
        mixed.map((i) => ({ id: i.id, version: 4 })),
      ),
    ).toBeNull();
    // Task: Rework → In Review hợp lệ? (Làm lại: In Review→Rework; ngược lại không có) → cũng null.
    const rework = opts.find((o) => o.name === 'Rework')!;
    expect(
      statusUndoPlan(
        workflows,
        rework,
        [t1, t2],
        [
          { id: 't1', version: 4 },
          { id: 't2', version: 4 },
        ],
      ),
    ).toBeNull();
    // Pending ↔ mở: Task In Review → Pending, rồi Pending → In Review có bước "Tiếp tục: In Review" → có Hoàn tác.
    const pending = opts.find((o) => o.id === 'name:pending')!;
    const plan = statusUndoPlan(
      workflows,
      pending,
      mixed,
      mixed.map((i) => ({ id: i.id, version: 4 })),
    );
    expect(plan).not.toBeNull();
    expect(plan!.map((p) => [p.patch.statusId, p.items.map((x) => x.id)])).toEqual([
      [statusIdOf('STANDARD', 'In Review'), ['t1', 't2']],
      [statusIdOf('BUG', 'Ready for Retest'), ['b1', 'b2']],
    ]);
  });
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setupHook(selected: string[], retain = vi.fn()) {
  return {
    retain,
    ...renderHook(
      () =>
        useBulkEdit({
          projectId: 'p1',
          issues: mixed,
          selected: new Set(selected),
          retainSelection: retain,
          workflows,
          sprints: undefined,
        }),
      { wrapper },
    ),
  };
}

beforeEach(() => {
  h.patch.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  // Máy chủ giả: mọi việc trong request cập nhật được, version + 1.
  h.patch.mockImplementation((_url: string, body: BulkBody) =>
    Promise.resolve({
      data: {
        updated: body.items.map((i) => ({
          ...mixed.find((m) => m.id === i.id)!,
          version: i.version + 1,
        })),
        conflicts: [],
      },
    }),
  );
});
afterEach(cleanup);

describe('useBulkEdit.setStatus trên lô trộn Task + Bug', () => {
  it('"Done" cùng tên → hai request, mỗi quy trình đúng Done của nó; một toast tổng kết', async () => {
    const { result, retain } = setupHook(['t1', 't2', 'b1', 'b2']);
    const done = bulkStatusOptions(workflows, mixed).find((o) => o.id === 'name:done')!;
    await act(() => result.current.setStatus(done));
    expect(h.patch).toHaveBeenCalledTimes(2);
    const sent = h.patch.mock.calls.map(([, body]) => ({
      ids: body.items.map((i) => i.id),
      to: body.patch.statusId,
    }));
    expect(sent).toEqual([
      { ids: ['t1', 't2'], to: statusIdOf('STANDARD', 'Done') },
      { ids: ['b1', 'b2'], to: statusIdOf('BUG', 'Done') },
    ]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success).mock.calls[0]![0]).toBe('Đã chuyển trạng thái cho 4 việc.');
    expect(retain).toHaveBeenCalledWith(new Set());
  });

  it('bước chỉ của Bug (Reopened): chỉ Bug được gửi, Task giữ nguyên VÀ vẫn được chọn, toast nói rõ', async () => {
    const { result, retain } = setupHook(['t1', 't2', 'b1', 'b2']);
    const reopened = bulkStatusOptions(workflows, mixed).find((o) => o.name === 'Reopened')!;
    await act(() => result.current.setStatus(reopened));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![1].items.map((i) => i.id)).toEqual(['b1', 'b2']);
    expect(h.patch.mock.calls[0]![1].patch).toEqual({ statusId: statusIdOf('BUG', 'Reopened') });
    expect(retain).toHaveBeenCalledWith(new Set(['t1', 't2']));
    const [title, opts] = vi.mocked(toast.success).mock.calls[0]!;
    expect(title).toBe('Đã chuyển trạng thái cho 2 việc.');
    expect((opts as { description?: string }).description).toContain(
      '2 việc không có bước chuyển này',
    );
  });

  it('request của quy trình thứ hai lỗi: kết quả quy trình đầu được giữ, việc còn lại vẫn được chọn', async () => {
    h.patch.mockReset();
    h.patch
      .mockResolvedValueOnce({
        data: {
          updated: [
            { ...t1, version: 4 },
            { ...t2, version: 4 },
          ],
          conflicts: [],
        },
      })
      .mockRejectedValueOnce(new Error('mạng đứt'));
    const { result, retain } = setupHook(['t1', 't2', 'b1', 'b2']);
    const done = bulkStatusOptions(workflows, mixed).find((o) => o.id === 'name:done')!;
    await act(() => result.current.setStatus(done));
    expect(retain).toHaveBeenCalledWith(new Set(['b1', 'b2']));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.warning).mock.calls[0]![0]).toBe(
      'Đã cập nhật 2 việc · 2 việc chưa cập nhật được',
    );
  });
});
