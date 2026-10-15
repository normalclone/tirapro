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
import {
  useCan,
  useCanEditIssue,
  useCanIn,
  useProjectArchived,
  useProjectCan,
} from './permissions';

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

describe('useProjectCan', () => {
  function probeProject(
    qc: QueryClient,
    project: { id: string; archivedAt: string | null } | undefined,
    perm: string,
  ) {
    let result: boolean | undefined;
    function Probe() {
      result = useProjectCan(project)(perm as never);
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
    qc.setQueryData(keys.projects.permissions('p1'), {
      projectId: 'p1',
      permissions: ['issue:create', 'board:manage', 'report:view'],
    });
  });

  it('dự án đang hoạt động → như useCan', () => {
    const p = { id: 'p1', archivedAt: null };
    expect(probeProject(qc, p, 'issue:create')).toBe(true);
    expect(probeProject(qc, p, 'board:manage')).toBe(true);
  });
  it('dự án đã lưu trữ → quyền ghi tắt hết, quyền đọc còn', () => {
    const p = { id: 'p1', archivedAt: '2026-10-10T00:00:00.000Z' };
    expect(probeProject(qc, p, 'issue:create')).toBe(false);
    expect(probeProject(qc, p, 'board:manage')).toBe(false);
    expect(probeProject(qc, p, 'report:view')).toBe(true);
    expect(probeProject(qc, p, 'project:view')).toBe(true);
  });
  it('system admin cũng chỉ đọc khi dự án đã lưu trữ (khớp API 422 với mọi người)', () => {
    useAuth.setState({ user: { id: 'a', isSystemAdmin: true } as never, permissions: [] });
    expect(
      probeProject(qc, { id: 'p1', archivedAt: '2026-10-10T00:00:00.000Z' }, 'issue:create'),
    ).toBe(false);
    expect(probeProject(qc, { id: 'p1', archivedAt: null }, 'issue:create')).toBe(true);
  });
  it('chưa có project → như useCan(undefined)', () => {
    expect(probeProject(qc, undefined, 'issue:create')).toBe(false);
  });
});

describe('dự án lưu trữ tra theo projectId (trang issue, panel, Cmd+K)', () => {
  const ARCHIVED = '2026-10-10T00:00:00.000Z';
  const proj = (id: string, archivedAt: string | null) => ({
    id,
    key: id.toUpperCase(),
    archivedAt,
  });
  let qc: QueryClient;
  function render<T>(use: () => T): T {
    let result: T | undefined;
    function Probe() {
      result = use();
      return null;
    }
    renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Probe)));
    return result as T;
  }
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    useAuth.setState({
      user: { id: 'u1', isSystemAdmin: false } as never,
      permissions: ['project:view'],
    });
    qc.setQueryData(keys.projects.permissions('p1'), {
      projectId: 'p1',
      permissions: ['issue:edit', 'issue:transition', 'comment:create', 'report:view'],
    });
    qc.setQueryData(keys.projects.permissions('p2'), {
      projectId: 'p2',
      permissions: ['issue:edit', 'issue:transition'],
    });
    // Danh sách KÈM lưu trữ: p1 hoạt động, p2 đã lưu trữ.
    qc.setQueryData(keys.projects.withArchived, [proj('p1', null), proj('p2', ARCHIVED)]);
  });

  it('useProjectArchived: đúng theo danh sách; không có id / chưa tải → false', () => {
    expect(render(() => useProjectArchived('p2'))).toBe(true);
    expect(render(() => useProjectArchived('p1'))).toBe(false);
    expect(render(() => useProjectArchived(undefined))).toBe(false);
    qc.removeQueries({ queryKey: keys.projects.withArchived });
    expect(render(() => useProjectArchived('p2'))).toBe(false);
  });
  it('useCanIn: dự án hoạt động như useCan; lưu trữ → ghi tắt, đọc còn', () => {
    expect(render(() => useCanIn('p1'))('issue:transition')).toBe(true);
    expect(render(() => useCanIn('p1'))('comment:create')).toBe(true);
    expect(render(() => useCanIn('p2'))('issue:transition')).toBe(false);
    expect(render(() => useCanIn('p2'))('project:view')).toBe(true);
  });
  it('useCanIn: system admin cũng chỉ đọc khi dự án lưu trữ', () => {
    useAuth.setState({ user: { id: 'a', isSystemAdmin: true } as never, permissions: [] });
    expect(render(() => useCanIn('p2'))('issue:edit')).toBe(false);
    expect(render(() => useCanIn('p1'))('issue:edit')).toBe(true);
  });
  it('useCanEditIssue: dự án lưu trữ → không sửa được kể cả có issue:edit', () => {
    const issue = { reporterId: 'u1', assigneeId: null };
    expect(render(() => useCanEditIssue('p1'))(issue)).toBe(true);
    expect(render(() => useCanEditIssue('p2'))(issue)).toBe(false);
  });
  it('useCan thô KHÔNG đổi (dùng cho quản trị dự án như khôi phục dự án lưu trữ)', () => {
    expect(render(() => useCan('p2'))('issue:edit')).toBe(true);
  });
});
