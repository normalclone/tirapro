import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/lib/queryKeys';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
  refreshAccessToken: vi.fn(),
  apiErrorMessage: vi.fn(),
  wasErrorDescribed: vi.fn(),
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
// renderToString đọc zustand qua getServerSnapshot (= state khởi tạo, bỏ qua setState) → thay bằng store giả đọc state hiện tại.
vi.mock('@/stores/auth', () => {
  let state: Record<string, unknown> = {};
  const useAuth = Object.assign(<T>(sel: (s: Record<string, unknown>) => T) => sel(state), {
    setState: (p: Record<string, unknown>) => {
      state = { ...state, ...p };
    },
  });
  return { useAuth };
});
import { useAuth } from '@/stores/auth';
import { useCan, useCanEditIssue } from './permissions';

/** Vẽ một component dò, trả kết quả `can(perm)` ở lần vẽ đầu (cache đã nạp sẵn nên useQuery trả đồng bộ). */
function probe(qc: QueryClient, projectId: string | undefined, perm: string) {
  let result: boolean | undefined;
  function Probe() {
    result = useCan(projectId)(perm as never);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
  return result;
}

describe('useCan', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    useAuth.setState({
      user: { id: 'u1', isSystemAdmin: false } as never,
      permissions: ['project:view'],
    });
  });

  it('Member chỉ có worklog:create ở dự án → true khi dự án đã tải', () => {
    qc.setQueryData(keys.projects.permissions('p1'), {
      projectId: 'p1',
      permissions: ['worklog:create'],
    });
    expect(probe(qc, 'p1', 'worklog:create')).toBe(true);
  });
  it('quyền của dự án p1 không rò sang p2', () => {
    qc.setQueryData(keys.projects.permissions('p1'), {
      projectId: 'p1',
      permissions: ['worklog:create'],
    });
    expect(probe(qc, 'p2', 'worklog:create')).toBe(false);
  });
  it('chưa tải/không có projectId → rơi về quyền workspace', () => {
    expect(probe(qc, 'p1', 'project:view')).toBe(true);
    expect(probe(qc, undefined, 'worklog:create')).toBe(false);
  });
  it('system admin luôn true', () => {
    useAuth.setState({ user: { id: 'a', isSystemAdmin: true } as never, permissions: [] });
    expect(probe(qc, 'p1', 'issue:delete')).toBe(true);
  });
});

describe('useCanEditIssue', () => {
  const issue = { reporterId: 'u1', assigneeId: null };
  function probeEdit(
    qc: QueryClient,
    projectId: string,
    i: { reporterId: string | null; assigneeId: string | null },
  ) {
    let result: boolean | undefined;
    function Probe() {
      result = useCanEditIssue(projectId)(i);
      return null;
    }
    renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
    return result;
  }
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    useAuth.setState({
      user: { id: 'u1', isSystemAdmin: false } as never,
      permissions: ['project:view'],
    });
  });

  it('Project Reporter (issue:edit:own): sửa được việc của mình, không sửa được việc người khác', () => {
    qc.setQueryData(keys.projects.permissions('p1'), {
      projectId: 'p1',
      permissions: ['issue:edit:own'],
    });
    expect(probeEdit(qc, 'p1', issue)).toBe(true);
    expect(probeEdit(qc, 'p1', { reporterId: 'other', assigneeId: null })).toBe(false);
  });
  it('Viewer (không có quyền sửa) → không sửa được kể cả việc của mình', () => {
    qc.setQueryData(keys.projects.permissions('p1'), {
      projectId: 'p1',
      permissions: ['project:view'],
    });
    expect(probeEdit(qc, 'p1', issue)).toBe(false);
  });
  it('Developer (issue:edit) → sửa mọi việc', () => {
    qc.setQueryData(keys.projects.permissions('p1'), {
      projectId: 'p1',
      permissions: ['issue:edit'],
    });
    expect(probeEdit(qc, 'p1', { reporterId: 'other', assigneeId: null })).toBe(true);
  });
});
