// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { defaultWorkflow, statusIdOf } from '@/features/issues/workflowFixtures';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get } };
});

import { useProjectStatuses } from './api';

const std = defaultWorkflow('STANDARD');
const bug = defaultWorkflow('BUG');
const epic = defaultWorkflow('EPIC');

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
});
afterEach(cleanup);

describe('useProjectStatuses — cột bảng gom trạng thái của mọi quy trình đang dùng', () => {
  it('Task + Bug cùng dự án: trạng thái của cả hai quy trình, kèm tên quy trình; không có quy trình không dùng (Epic)', async () => {
    h.get.mockImplementation((url: string) => {
      if (url === '/projects/p1/workflow-overrides')
        return Promise.resolve({
          data: {
            projectId: 'p1',
            issueTypes: [],
            items: [
              {
                issueTypeId: 't1',
                workflowId: std.id,
                isOverride: false,
                workspaceWorkflowId: std.id,
              },
              {
                issueTypeId: 't2',
                workflowId: bug.id,
                isOverride: false,
                workspaceWorkflowId: bug.id,
              },
            ],
          },
        });
      if (url === '/workflows') return Promise.resolve({ data: [epic, bug, std] });
      return Promise.reject(new Error(`GET ${String(url)}`));
    });
    const { result } = renderHook(() => useProjectStatuses('p1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const list = result.current.data!;
    const names = (flow: string) => list.filter((s) => s.workflowName === flow).map((s) => s.name);
    expect(names('Standard Workflow')).toContain('In Review');
    expect(names('Bug Workflow')).toContain('Ready for Retest');
    expect(list.some((s) => s.workflowName === 'Epic Workflow')).toBe(false);
    // "To Do" của hai quy trình là hai trạng thái khác nhau (id khác).
    const todos = list.filter((s) => s.name === 'To Do').map((s) => s.id);
    expect(todos).toEqual([statusIdOf('STANDARD', 'To Do'), statusIdOf('BUG', 'To Do')]);
    // Trong mỗi quy trình giữ thứ tự trạng thái.
    expect(names('Bug Workflow')[0]).toBe('New');
  });

  it('dự án chưa có cấu hình theo loại việc → quy trình riêng của dự án như trước', async () => {
    h.get.mockImplementation((url: string) => {
      if (url === '/projects/p1/workflow-overrides')
        return Promise.resolve({ data: { projectId: 'p1', issueTypes: [], items: [] } });
      if (url === '/workflows') return Promise.resolve({ data: [std] });
      if (url === '/workflows?projectId=p1') return Promise.resolve({ data: [bug] });
      return Promise.reject(new Error(`GET ${String(url)}`));
    });
    const { result } = renderHook(() => useProjectStatuses('p1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(new Set(result.current.data!.map((s) => s.workflowName))).toEqual(
      new Set(['Bug Workflow']),
    );
  });
});
