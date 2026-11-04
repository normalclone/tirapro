// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeIssueItemDto, MeOverviewDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { MeOverviewPage } from './MeOverviewPage';

// jsdom không có ResizeObserver (recharts ResponsiveContainer cần); biểu đồ được kiểm qua mô tả chữ (aria-label).
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: (...a: unknown[]) => get(...a) } };
});

afterEach(() => {
  cleanup();
  get.mockReset();
});

const item = (
  key: string,
  projectKey: string,
  o: Partial<MeIssueItemDto> = {},
): MeIssueItemDto => ({
  id: key,
  key,
  summary: `Tóm tắt ${key}`,
  projectId: `p-${projectKey}`,
  projectKey,
  type: { id: 't', name: 'Task', key: 'TASK' },
  status: { id: 's', name: 'Đang làm', category: 'IN_PROGRESS' },
  priority: { id: 'p', name: 'High', rank: 4 },
  points: 3,
  dueDate: '2099-01-15T00:00:00.000Z',
  ...o,
});

const empty = { awaitingRetest: [], reopened: [], assignedToMe: [] };
const weeks = (
  ...rows: [string, { projectKey: string; points: number }[]][]
): MeOverviewDto['weeklyDonePoints'] =>
  rows.map(([weekStart, byProject]) => ({ weekStart, byProject }));

const data = (o: Partial<MeOverviewDto> = {}): MeOverviewDto => ({
  counts: { open: 3, overdue: 1, dueSoon: 2, donePointsThisWeek: 7 },
  myIssues: [
    item('AAA-1', 'AAA', { dueDate: '2020-01-02T00:00:00.000Z' }),
    item('BBB-2', 'BBB', { status: { id: 's2', name: 'Chờ test', category: 'IN_PROGRESS' } }),
    item('AAA-3', 'AAA', { points: null, dueDate: null, priority: null }),
  ],
  bugs: empty,
  weeklyDonePoints: weeks(['2026-10-26', []], ['2026-11-02', [{ projectKey: 'AAA', points: 7 }]]),
  ...o,
});

function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="loc">{loc.pathname}</p>;
}

function renderPage(d: MeOverviewDto) {
  get.mockImplementation((url: string) =>
    url === '/me/overview' ? Promise.resolve({ data: d }) : Promise.reject(new Error('offline')),
  );
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/me']}>
        <Routes>
          <Route path="/me" element={<MeOverviewPage />} />
          <Route path="/issue/:key" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Trang Của tôi', () => {
  it('một h1 "Của tôi"; ô số; danh sách nhiều dự án kèm chip mã dự án, tên trạng thái thật, điểm và hạn dd/MM/yyyy', async () => {
    renderPage(data());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Của tôi');
    await screen.findByText('Việc chưa xong');
    for (const label of ['Quá hạn', 'Đến hạn trong 7 ngày', 'Điểm xong tuần này'])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    const list = screen.getByRole('region', { name: 'Việc của tôi' });
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('AAA');
    expect(rows[0]!.textContent).toContain('AAA-1');
    expect(rows[0]!.textContent).toContain('02/01/2020'); // hạn là ngày lịch, không lệch múi giờ
    expect(rows[0]!.textContent).toContain('Quá hạn');
    expect(rows[1]!.textContent).toContain('Chờ test'); // tên trạng thái luôn hiện
    expect(rows[1]!.textContent).toContain('3 điểm');
    expect(rows[2]!.textContent).toContain('Chưa có hạn');
  });

  it('chip lọc theo dự án: chọn → chỉ việc dự án đó; bấm lại hoặc "Tất cả" → đủ', async () => {
    renderPage(data());
    const group = await screen.findByRole('group', { name: 'Lọc theo dự án' });
    const aaa = within(group).getByRole('button', { name: /AAA/ });
    expect(aaa.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(aaa);
    const list = screen.getByRole('region', { name: 'Việc của tôi' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).queryByText('Tóm tắt BBB-2')).toBeNull();
    expect(aaa.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(aaa);
    expect(within(list).getAllByRole('link')).toHaveLength(3);
    fireEvent.click(within(group).getByRole('button', { name: /BBB/ }));
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    fireEvent.click(within(group).getByRole('button', { name: /Tất cả/ }));
    expect(within(list).getAllByRole('link')).toHaveLength(3);
  });

  it('chỉ một dự án → không hiện hàng chip', async () => {
    renderPage(data({ myIssues: [item('AAA-1', 'AAA')] }));
    await screen.findByRole('region', { name: 'Việc của tôi' });
    expect(screen.queryByRole('group', { name: 'Lọc theo dự án' })).toBeNull();
  });

  it('bấm một việc → mở /issue/:key', async () => {
    renderPage(data());
    const list = await screen.findByRole('region', { name: 'Việc của tôi' });
    fireEvent.click(within(list).getByText('Tóm tắt BBB-2'));
    expect((await screen.findByTestId('loc')).textContent).toBe('/issue/BBB-2');
  });

  it('tab bug: mở sẵn tab đầu có việc, đổi tab hiện đúng danh sách, tab rỗng có empty state', async () => {
    renderPage(
      data({
        bugs: {
          awaitingRetest: [],
          reopened: [item('AAA-9', 'AAA')],
          assignedToMe: [item('BBB-8', 'BBB'), item('BBB-7', 'BBB')],
        },
      }),
    );
    const tablist = await screen.findByRole('tablist', { name: 'Nhóm bug liên quan đến tôi' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Chờ test lại · 0',
      'Mở lại · 1',
      'Giao cho tôi · 2',
    ]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Tóm tắt AAA-9')).toBeTruthy();
    fireEvent.click(tabs[2]!);
    expect(within(screen.getByRole('tabpanel')).getAllByRole('link')).toHaveLength(2);
    fireEvent.click(tabs[0]!);
    expect(
      within(screen.getByRole('tabpanel')).getByText('Không có bug nào chờ bạn test lại'),
    ).toBeTruthy();
  });

  it('empty state: không việc, không điểm → giải thích + liên kết sang Dự án; biểu đồ báo chưa có điểm', async () => {
    renderPage({
      counts: { open: 0, overdue: 0, dueSoon: 0, donePointsThisWeek: 0 },
      myIssues: [],
      bugs: empty,
      weeklyDonePoints: weeks(['2026-11-02', []]),
    });
    expect(await screen.findByText('Bạn không có việc nào đang chờ')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Xem các dự án' }).getAttribute('href')).toBe(
      '/projects',
    );
    expect(screen.getByText('Chưa có điểm hoàn thành trong 8 tuần qua')).toBeTruthy();
  });

  it('biểu đồ có mô tả chữ cho trình đọc màn hình (điểm theo dự án từng tuần)', async () => {
    renderPage(data());
    const img = await screen.findByRole('img', { name: /Điểm đã xong theo tuần/ });
    expect(img.getAttribute('aria-label')).toBe(
      'Điểm đã xong theo tuần, tuần 02/11: 7 điểm (AAA 7)',
    );
  });

  it('lỗi tải → thông báo lỗi có nút Thử lại; không dùng từ "workspace" trong chữ hiển thị', async () => {
    get.mockRejectedValue(new Error('boom'));
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <MeOverviewPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: /Thử lại/ })).toBeTruthy();
    expect(container.textContent?.toLowerCase()).not.toContain('workspace');
  });
});
