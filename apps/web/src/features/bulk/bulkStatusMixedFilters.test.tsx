// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';
import { mk } from '@/lib/issueFixture';
import { bulkStatusOptions } from './bulkEdit';

type BulkBody = { items: Array<{ id: string; version: number }>; patch: { statusId: string } };
const h = vi.hoisted(() => ({
  patch: vi.fn<(url: string, body: BulkBody) => Promise<unknown>>(),
}));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { patch: h.patch, get: vi.fn() } };
});
vi.mock('@/features/projects/permissions', () => ({
  useProjectPermissionContexts: () => () => ({
    ctx: { isSystemAdmin: true, workspace: [], project: undefined },
    archived: false,
  }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { useGroupedBulkEdit } from './useGroupedBulkEdit';

const std = defaultWorkflow('STANDARD');
const bug = defaultWorkflow('BUG');
const workflows = [std, bug];
const issue = (id: string, key: 'STANDARD' | 'BUG', statusName: string): IssueDto => {
  const wf = key === 'BUG' ? bug : std;
  const s = wf.statuses.find((x) => x.name === statusName)!;
  return mk(id, { projectId: 'p1', version: 3, status: { ...s, workflowId: wf.id } });
};
const mixed = [
  issue('t1', 'STANDARD', 'In Review'),
  issue('b1', 'BUG', 'Ready for Retest'),
  issue('b2', 'BUG', 'Ready for Retest'),
];

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.patch.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
  h.patch.mockImplementation(
    (_u: string, body: { items: Array<{ id: string; version: number }> }) =>
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

describe('Kết quả bộ lọc: đổi trạng thái lô trộn Task + Bug trong cùng dự án', () => {
  function setup(selected: string[]) {
    const retain = vi.fn();
    const hook = renderHook(
      () =>
        useGroupedBulkEdit({
          issues: mixed,
          selected: new Set(selected),
          retainSelection: retain,
          workflows,
          projectKeyById: new Map([['p1', 'KYHOP']]),
        }),
      { wrapper },
    );
    return { retain, ...hook };
  }

  it('"Done" cùng tên → mỗi quy trình một request đúng đích, một toast tổng kết', async () => {
    const { result, retain } = setup(['t1', 'b1', 'b2']);
    const done = bulkStatusOptions(workflows, mixed).find((o) => o.id === 'name:done')!;
    await act(() => result.current.setStatus(done));
    expect(h.patch).toHaveBeenCalledTimes(2);
    expect(h.patch.mock.calls.map(([, b]) => [b.items.map((i) => i.id), b.patch.statusId])).toEqual(
      [
        [['t1'], statusIdOf('STANDARD', 'Done')],
        [['b1', 'b2'], statusIdOf('BUG', 'Done')],
      ],
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(retain).toHaveBeenCalledWith(new Set());
  });

  it('bước chỉ của Bug → Task giữ nguyên và vẫn được chọn', async () => {
    const { result, retain } = setup(['t1', 'b1', 'b2']);
    const reopened = bulkStatusOptions(workflows, mixed).find((o) => o.name === 'Reopened')!;
    await act(() => result.current.setStatus(reopened));
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch.mock.calls[0]![1].items.map((i) => i.id)).toEqual(['b1', 'b2']);
    expect(retain).toHaveBeenCalledWith(new Set(['t1']));
    const [, opts] = vi.mocked(toast.success).mock.calls[0]!;
    expect((opts as { description?: string }).description).toContain(
      '1 việc không có bước chuyển này',
    );
  });
});
