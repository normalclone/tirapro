// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';
import { defaultWorkflow, statusIdOf } from './workflowFixtures';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: vi.fn() } };
});

import { useIssueTransitions } from './useIssueTransitions';

const std = defaultWorkflow('STANDARD');
const bug = defaultWorkflow('BUG');

const typeOf = (id: string) => ({
  id,
  name: id,
  key: null,
  iconUrl: null,
  color: null,
  hierarchyLevel: 0,
  isSubtask: false,
});
/** Cấu hình dự án: Task → Standard, Bug → Bug Workflow. */
const SCHEME = {
  projectId: 'p1',
  issueTypes: [],
  items: [
    {
      issueTypeId: 'ty-task',
      workflowId: std.id,
      isOverride: false,
      organizationWorkflowId: std.id,
    },
    {
      issueTypeId: 'ty-bug',
      workflowId: bug.id,
      isOverride: false,
      organizationWorkflowId: bug.id,
    },
  ],
};

const issueIn = (key: 'STANDARD' | 'BUG', statusName: string): IssueDto => {
  const wf = key === 'BUG' ? bug : std;
  const s = wf.statuses.find((x) => x.name === statusName)!;
  return mk(`${key}-${statusName}`, {
    projectId: 'p1',
    type: typeOf(key === 'BUG' ? 'ty-bug' : 'ty-task'),
    status: { ...s, workflowId: wf.id },
  });
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url === '/workflows') return Promise.resolve({ data: [std, bug] });
    if (url === '/projects/p1/workflow-overrides') return Promise.resolve({ data: SCHEME });
    if (url === '/projects')
      return Promise.resolve({ data: [{ id: 'p1', key: 'KYHOP', name: 'KYHOP' }] });
    if (url === '/projects/KYHOP/meta') return Promise.resolve({ data: { resolutions: [] } });
    if (url.endsWith('/transitions'))
      return Promise.resolve({
        data: {
          workflowId: bug.id,
          currentStatusId: statusIdOf('BUG', 'Pending'),
          transitions: [],
          suggestedResumeStatusId: statusIdOf('BUG', 'Ready for Retest'),
        },
      });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
});
afterEach(cleanup);

async function nextNames(issue: IssueDto) {
  const { result } = renderHook(() => useIssueTransitions(issue), { wrapper });
  await waitFor(() => expect(result.current.nextStatuses.length).toBeGreaterThan(0));
  return result;
}

describe('Nút chuyển trạng thái theo quy trình của chính loại việc (cùng dự án)', () => {
  it('Task ở In Review → Hoàn thành / Làm lại; Bug ở Ready for Retest → Đạt / Mở lại', async () => {
    const task = await nextNames(issueIn('STANDARD', 'In Review'));
    const taskNames = task.current.nextStatuses.map((s) => s.name);
    expect(taskNames).toEqual(expect.arrayContaining(['Done', 'Rework', 'Pending', 'Cancelled']));
    expect(taskNames).not.toContain('Reopened');
    expect(taskNames).not.toContain('Closed');

    const b = await nextNames(issueIn('BUG', 'Ready for Retest'));
    const bugNames = b.current.nextStatuses.map((s) => s.name);
    expect(bugNames).toEqual(expect.arrayContaining(['Done', 'Reopened', 'Pending', 'Cancelled']));
    expect(bugNames).not.toContain('Rework');
    // Nút của Bug mang đúng id trạng thái của quy trình Bug.
    expect(b.current.nextStatuses.every((s) => s.id.startsWith('bug:'))).toBe(true);
    expect(task.current.nextStatuses.every((s) => s.id.startsWith('standard:'))).toBe(true);
  });

  it('không ở Pending → không gọi API gợi ý, không nút nào nổi bật', async () => {
    const r = await nextNames(issueIn('STANDARD', 'In Progress'));
    expect(r.current.nextStatuses.some((s) => s.suggested)).toBe(false);
    expect(h.get.mock.calls.some(([u]) => String(u).endsWith('/transitions'))).toBe(false);
  });

  it('rời Pending: trạng thái trước khi tạm dừng đứng đầu và được đánh dấu gợi ý', async () => {
    const issue = issueIn('BUG', 'Pending');
    const { result } = renderHook(() => useIssueTransitions(issue), { wrapper });
    await waitFor(() => expect(result.current.nextStatuses.some((s) => s.suggested)).toBe(true));
    const first = result.current.nextStatuses[0]!;
    expect(first).toMatchObject({ name: 'Ready for Retest', suggested: true });
    // Các bước còn lại vẫn đủ (chỉ đổi thứ tự).
    expect(result.current.nextStatuses.map((s) => s.name)).toEqual(
      expect.arrayContaining(['New', 'To Do', 'In Progress', 'Reopened']),
    );
    expect(h.get).toHaveBeenCalledWith(`/issues/${issue.id}/transitions`);
  });

  it('gợi ý không còn là bước hợp lệ của quy trình → bỏ qua, giữ nguyên danh sách', async () => {
    h.get.mockImplementation((url: string) => {
      if (url === '/workflows') return Promise.resolve({ data: [std, bug] });
      if (url === '/projects') return Promise.resolve({ data: [] });
      if (url.endsWith('/transitions'))
        return Promise.resolve({
          data: {
            workflowId: bug.id,
            currentStatusId: statusIdOf('BUG', 'Pending'),
            transitions: [],
            suggestedResumeStatusId: statusIdOf('STANDARD', 'In Review'),
          },
        });
      return Promise.reject(new Error('x'));
    });
    const issue = issueIn('BUG', 'Pending');
    const { result } = renderHook(() => useIssueTransitions(issue), { wrapper });
    await waitFor(() => expect(result.current.nextStatuses.length).toBeGreaterThan(0));
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(`/issues/${issue.id}/transitions`));
    expect(result.current.nextStatuses.some((s) => s.suggested)).toBe(false);
  });
});

describe('trạng thái hiện tại nằm ngoài quy trình của loại việc (dữ liệu lệch)', () => {
  it('Task mà đang ở trạng thái của Bug Workflow: không có bước nào, chỉ "chuyển về quy trình đúng" = trạng thái của Standard', async () => {
    const odd = { ...issueIn('BUG', 'Reopened'), type: typeOf('ty-task') };
    const { result } = renderHook(() => useIssueTransitions(odd), { wrapper });
    await waitFor(() => expect(result.current.mismatch).toBe(true));
    expect(result.current.workflowName).toBe('Standard Workflow');
    const ids = result.current.nextStatuses.map((s) => s.id);
    expect(ids.length).toBe(std.statuses.length);
    expect(ids.every((id) => id.startsWith('standard:'))).toBe(true);
    // Không còn gợi ý nào (không gọi API gợi ý vì không ở Pending).
    expect(result.current.nextStatuses.some((s) => s.suggested)).toBe(false);
  });
  it('việc nhất quán (Task ở Standard) không bị coi là lệch', async () => {
    const { result } = renderHook(() => useIssueTransitions(issueIn('STANDARD', 'In Review')), {
      wrapper,
    });
    await waitFor(() => expect(result.current.nextStatuses.length).toBeGreaterThan(0));
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/projects/p1/workflow-overrides'));
    expect(result.current.mismatch).toBe(false);
  });
});
