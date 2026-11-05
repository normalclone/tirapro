// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get } };
});

import {
  leadershipPath,
  overviewPath,
  projectIdsParam,
  qaProjectsPath,
  useScopedLeadership,
  useScopedOverview,
  useScopedQa,
} from './scopedReports';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const calls = () => h.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  h.get.mockReset();
  h.get.mockResolvedValue({ data: { projects: [], totals: {}, trend: [] } });
});

describe('đường dẫn báo cáo theo phạm vi', () => {
  it('danh sách RỖNG vẫn mang tham số projectIds= (vắng tham số = không thu hẹp)', () => {
    expect(projectIdsParam([])).toBe('projectIds=');
    expect(overviewPath([])).toBe('/reports/overview?projectIds=');
    expect(leadershipPath([])).toBe('/reports/leadership?projectIds=');
    expect(qaProjectsPath([], 30, new Date('2026-11-05T12:00:00Z'))).toMatch(
      /^\/reports\/qa\/projects\?projectIds=&from=.+&to=.+$/,
    );
  });
  it('có id → CSV đã mã hoá; null → không tham số; byAssignee chỉ khi bật', () => {
    expect(overviewPath(['a', 'b'])).toBe('/reports/overview?projectIds=a,b');
    expect(overviewPath(null)).toBe('/reports/overview');
    expect(overviewPath(['a'], true)).toBe('/reports/overview?projectIds=a&byAssignee=1');
    expect(overviewPath(null, true)).toBe('/reports/overview?byAssignee=1');
    expect(leadershipPath(null)).toBe('/reports/leadership');
    expect(projectIdsParam(['a b'])).toBe('projectIds=a%20b');
  });
});

describe('hook luôn gửi projectIds= khi phạm vi rỗng (M2)', () => {
  it('overview', async () => {
    renderHook(() => useScopedOverview([], true), { wrapper });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()).toEqual(['/reports/overview?projectIds=']);
  });
  it('overview toàn tổ chức (null) không gửi projectIds', async () => {
    renderHook(() => useScopedOverview(null, true), { wrapper });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()).toEqual(['/reports/overview']);
  });
  it('leadership', async () => {
    renderHook(() => useScopedLeadership([], true), { wrapper });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()).toEqual(['/reports/leadership?projectIds=']);
  });
  it('qa/projects (nhóm rỗng)', async () => {
    renderHook(() => useScopedQa({ kind: 'projects', ids: [] }, true), { wrapper });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatch(/^\/reports\/qa\/projects\?projectIds=&from=/);
  });
  it('qa toàn tổ chức: lấy mã dự án từ tổng quan rồi gọi qa/projects; một dự án dùng /reports/qa?projectId', async () => {
    h.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.startsWith('/reports/overview')
          ? { projects: [{ id: 'p1' }, { id: 'p2' }] }
          : { reopenRate: 0.1, openBySeverity: [] },
      }),
    );
    renderHook(() => useScopedQa({ kind: 'org' }, true), { wrapper });
    await waitFor(() =>
      expect(calls().some((u) => u.startsWith('/reports/qa/projects'))).toBe(true),
    );
    expect(calls().find((u) => u.startsWith('/reports/qa/projects'))).toMatch(/projectIds=p1,p2&/);
    h.get.mockClear();
    renderHook(() => useScopedQa({ kind: 'project', projectId: 'p9' }, true), { wrapper });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()[0]).toMatch(/^\/reports\/qa\?projectId=p9/);
  });
  it('không bật (thiếu quyền) → không gọi gì', () => {
    renderHook(() => useScopedOverview([], false), { wrapper });
    renderHook(() => useScopedQa({ kind: 'projects', ids: [] }, false), { wrapper });
    expect(h.get).not.toHaveBeenCalled();
  });
});
