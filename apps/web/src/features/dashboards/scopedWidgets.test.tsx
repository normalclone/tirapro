// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get } };
});

import { useAuth } from '@/stores/auth';
import { DashboardScopeProvider, ScopedWidget } from './scope/ScopedWidget';
import type { DashboardScopeInfo } from './scope/widgetScope';
import { IssueListWidget } from './widgets/IssueListWidget';
import { OverloadWidget } from './widgets/OverloadWidget';
import { StatNumberWidget } from './widgets/StatNumberWidget';
import { TopRisksWidget } from './widgets/TopRisksWidget';

const A = { id: 'pa', key: 'AAA', name: 'Alpha' };
const GROUP = (scopeProjects = [A]): DashboardScopeInfo => ({
  dataScope: 'GROUP',
  scopeProjects,
  programName: 'Đối tác',
});
const calls = () => h.get.mock.calls.map((c) => String(c[0]));

function show(
  node: React.ReactNode,
  dash: DashboardScopeInfo | null,
  server?: { inherits?: boolean; projectIds?: string[] | null },
  config: Record<string, unknown> = {},
) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <DashboardScopeProvider value={dash}>
          <ScopedWidget config={config} server={server}>
            {node}
          </ScopedWidget>
        </DashboardScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.get.mockReset();
  h.get.mockResolvedValue({ data: [] });
  useAuth.setState({ user: { id: 'me' } as never, permissions: ['report:view'] as never });
});
afterEach(cleanup);

describe('ô danh sách việc (ISSUE_LIST) theo phạm vi', () => {
  const cfg = { jql: 'assignee = currentUser() ORDER BY updated DESC', limit: 10 };

  it('phạm vi nhóm rỗng: KHÔNG gọi tìm kiếm, ô hiện trống (không chạy JQL không giới hạn)', async () => {
    show(<IssueListWidget title="Việc của tôi" config={cfg} />, GROUP([]), {
      inherits: true,
      projectIds: [],
    });
    expect(await screen.findByText(/không có dự án nào bạn xem được/i)).toBeTruthy();
    expect(calls().filter((u) => u.startsWith('/search'))).toEqual([]);
  });

  it('phạm vi nhóm: JQL được gắn project IN (mã dự án người xem thấy)', async () => {
    show(<IssueListWidget title="Việc của tôi" config={cfg} />, GROUP(), {
      inherits: true,
      projectIds: ['pa'],
    });
    await waitFor(() => expect(calls().some((u) => u.startsWith('/search'))).toBe(true));
    const url = decodeURIComponent(calls().find((u) => u.startsWith('/search'))!);
    expect(url).toContain(
      'project IN ("AAA") AND (assignee = currentUser()) ORDER BY updated DESC',
    );
  });

  it('toàn tổ chức: JQL nguyên văn', async () => {
    show(
      <IssueListWidget title="Việc của tôi" config={cfg} />,
      { dataScope: 'ORG', scopeProjects: null, programName: null },
      { inherits: true, projectIds: null },
    );
    await waitFor(() => expect(calls().some((u) => u.startsWith('/search'))).toBe(true));
    expect(decodeURIComponent(calls()[0]!)).toBe(
      '/search?jql=assignee = currentUser() ORDER BY updated DESC&limit=10',
    );
  });

  it('máy chủ trả 422 (câu lọc không hợp với quy trình) → trống kèm giải thích, không phải khung lỗi', async () => {
    const err = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 422, data: {} },
    });
    h.get.mockRejectedValue(err);
    show(<IssueListWidget title="Bug" config={cfg} />, GROUP(), {
      inherits: true,
      projectIds: ['pa'],
    });
    expect(await screen.findByText(/không áp dụng được với quy trình/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ô chỉ số (STAT_NUMBER) theo phạm vi', () => {
  it('nhóm rỗng: gọi overview?projectIds= (không bỏ tham số)', async () => {
    show(<StatNumberWidget title="Mở" config={{ metric: 'open' }} />, GROUP([]), {
      inherits: true,
      projectIds: [],
    });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()).toEqual(['/reports/overview?projectIds=']);
  });

  it('tỉ lệ mở lại: nhóm → qa/projects (kể cả rỗng), hiện phần trăm', async () => {
    h.get.mockResolvedValue({ data: { reopenRate: 0.25, openBySeverity: [], totals: {} } });
    show(<StatNumberWidget title="Tỉ lệ mở lại" config={{ metric: 'reopenRate' }} />, GROUP(), {
      inherits: true,
      projectIds: ['pa'],
    });
    expect(await screen.findByText('25%')).toBeTruthy();
    expect(calls()[0]).toMatch(/^\/reports\/qa\/projects\?projectIds=pa&from=/);
  });

  it('toàn tổ chức + thiếu quyền báo cáo cấp tổ chức → khoá, không gọi API tổng hợp', () => {
    useAuth.setState({ permissions: [] as never });
    show(<StatNumberWidget title="Mở" config={{ metric: 'open' }} />, null, {
      inherits: true,
      projectIds: null,
    });
    expect(screen.getByText(/Cần quyền xem báo cáo/)).toBeTruthy();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('nhóm dự án + không có quyền cấp tổ chức → vẫn hỏi máy chủ (quyền trong từng dự án đủ)', async () => {
    useAuth.setState({ permissions: [] as never });
    h.get.mockResolvedValue({
      data: { totals: { open: 7 }, projectCount: 1, trend: [] },
    });
    show(<StatNumberWidget title="Mở" config={{ metric: 'open' }} />, GROUP(), {
      inherits: true,
      projectIds: ['pa'],
    });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()[0]).toMatch(/^\/reports\/overview\?projectIds=pa/);
    expect(screen.queryByText(/Cần quyền xem báo cáo/)).toBeNull();
  });

  it('nhóm dự án mà máy chủ trả 403 (không dự án nào cho xem báo cáo) → ô báo thiếu quyền', async () => {
    useAuth.setState({ permissions: [] as never });
    h.get.mockRejectedValue(
      Object.assign(new Error('403'), { isAxiosError: true, response: { status: 403 } }),
    );
    show(<StatNumberWidget title="Mở" config={{ metric: 'open' }} />, GROUP(), {
      inherits: true,
      projectIds: ['pa'],
    });
    expect(await screen.findByText(/không có quyền/i)).toBeTruthy();
  });
});

describe('ô lãnh đạo theo phạm vi', () => {
  it('nhóm rỗng: leadership?projectIds= (không bỏ tham số)', async () => {
    h.get.mockResolvedValue({
      data: { topRisks: [], slowGoals: [], overloaded: [], unavailable: [] },
    });
    show(<TopRisksWidget title="Top rủi ro" config={{}} />, GROUP([]), {
      inherits: true,
      projectIds: [],
    });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(calls()).toEqual(['/reports/leadership?projectIds=']);
  });

  it('thẻ người quá tải ngoài phạm vi toàn tổ chức: trống có lý do và KHÔNG gọi API', () => {
    show(<OverloadWidget title="Người quá tải" config={{}} />, GROUP(), {
      inherits: true,
      projectIds: ['pa'],
    });
    expect(screen.getByText(/chỉ có khi bảng lấy số liệu toàn tổ chức/i)).toBeTruthy();
    expect(h.get).not.toHaveBeenCalled();
  });
});

describe('nhãn phạm vi trên ô', () => {
  it('ô kế thừa hiện "Nhóm … · N dự án"', async () => {
    show(<StatNumberWidget title="Mở" config={{ metric: 'open' }} />, GROUP(), {
      inherits: true,
      projectIds: ['pa'],
    });
    expect(await screen.findByText('Nhóm Đối tác · 1 dự án')).toBeTruthy();
  });
});
