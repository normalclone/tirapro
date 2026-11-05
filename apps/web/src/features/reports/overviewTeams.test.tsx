// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get } };
});
vi.mock('@/features/projects/HealthOverrideCard', () => ({
  HealthOverrideCard: () => <div data-testid="health">Sức khoẻ dự án</div>,
}));
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Bar: Stub,
    BarChart: Stub,
    CartesianGrid: Stub,
    Cell: Stub,
    Legend: Stub,
    Pie: Stub,
    PieChart: Stub,
    ResponsiveContainer: Stub,
    Tooltip: Stub,
    XAxis: Stub,
    YAxis: Stub,
  };
});

import { OverviewTab } from './OverviewTab';

const report = (teamId: string | null) => ({
  totals: { total: 7, todo: 4, inProgress: 1, done: 2, overdue: 1, unassigned: 1, points: 12 },
  completionRate: 29,
  health: null,
  highPriUnassigned: 0,
  dueSoon: 0,
  byStatus: [{ name: 'To Do', color: null, count: 7 }],
  byType: [{ name: 'Task', color: null, count: 7 }],
  byPriority: [{ name: 'High', color: null, count: 7 }],
  byAssignee: [{ id: 'u1', name: 'An', total: 7, inProgress: 1, done: 2, overdue: 1, points: 12 }],
  byTeam:
    teamId === null
      ? [
          {
            id: 's1',
            name: 'QA',
            color: '#22c55e',
            memberCount: 2,
            total: 5,
            inProgress: 1,
            done: 1,
            overdue: 0,
            points: 9,
          },
          {
            id: null,
            name: 'Chưa thuộc team nào',
            color: null,
            memberCount: 0,
            total: 2,
            inProgress: 0,
            done: 1,
            overdue: 1,
            points: 3,
          },
        ]
      : [
          {
            id: 's1',
            name: 'QA',
            color: '#22c55e',
            memberCount: 2,
            total: 5,
            inProgress: 1,
            done: 1,
            overdue: 0,
            points: 9,
          },
        ],
  teamId,
});

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: () => undefined,
    configurable: true,
    writable: true,
  });
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  h.get.mockReset();
  h.get.mockImplementation((url: string, cfg?: { params?: { teamId?: string } }) => {
    if (url === '/projects/p1/sub-teams')
      return Promise.resolve({
        data: [
          {
            id: 's1',
            projectId: 'p1',
            name: 'QA',
            color: '#22c55e',
            members: [],
            memberCount: 2,
            createdAt: '',
          },
        ],
      });
    if (url === '/reports/project')
      return Promise.resolve({ data: report(cfg?.params?.teamId ?? null) });
    return Promise.resolve({ data: [] });
  });
});
afterEach(cleanup);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OverviewTab project={{ id: 'p1', key: 'DEMO', archivedAt: null }} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('Báo cáo dự án theo team', () => {
  it('có bảng "Theo team trong dự án" với dòng "Chưa thuộc team nào" và chú thích người ở nhiều team', async () => {
    setup();
    await screen.findByText('Theo team trong dự án');
    const table = screen.getByText('Team QA').closest('table')!;
    expect(within(table).getByText('Chưa thuộc team nào')).toBeTruthy();
    expect(document.body.textContent).toContain('tính vào từng team');
    expect(document.body.textContent).toContain('Điểm chỉ cộng việc lá');
  });

  it('lọc theo team: gọi API với teamId, hiện chú thích và nói rõ Sức khoẻ vẫn là của cả dự án', async () => {
    const u = setup();
    await screen.findByText('Theo team trong dự án');
    await u.click(screen.getByRole('button', { name: 'Lọc báo cáo theo team' }));
    await u.click(await screen.findByRole('option', { name: /Team QA/ }));
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/reports/project', {
        params: { projectId: 'p1', teamId: 's1' },
      }),
    );
    const note = await screen.findByRole('status');
    expect(note.textContent).toContain('Đang xem số liệu của Team QA');
    expect(note.textContent).toContain('Sức khoẻ dự án bên dưới vẫn tính cho cả dự án');
    expect(screen.getByTestId('health')).toBeTruthy();
  });

  it('dự án chưa có team: không có ô lọc cũng không có bảng theo team', async () => {
    h.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url === '/reports/project' ? { ...report(null), byTeam: [] } : [],
      }),
    );
    setup();
    await screen.findByTestId('health');
    expect(screen.queryByRole('button', { name: 'Lọc báo cáo theo team' })).toBeNull();
    expect(screen.queryByText('Theo team trong dự án')).toBeNull();
  });
});
