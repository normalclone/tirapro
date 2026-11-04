// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAuth } from '@/stores/auth';
import { MembersPage } from './MembersPage';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function renderAt(
  url: string,
  who: { admin: boolean; permissions: string[] } = { admin: true, permissions: [] },
) {
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'me', displayName: 'Tôi', email: 'me@x', isSystemAdmin: who.admin } as never,
      permissions: who.permissions as never,
    });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <MembersPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
    writable: true,
  });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  h.get.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url === '/resources/workload')
      return Promise.resolve({ data: { rows: [], weeks: [], hoursPerDay: 8 } });
    return Promise.resolve({ data: [] });
  });
});
afterEach(cleanup);

describe('Thành viên > tab Nhân lực (thay cho /manage/resources)', () => {
  it('trang Thành viên có ba tab: Thành viên, Nhóm, Nhân lực', () => {
    renderAt('/members');
    const names = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(names).toEqual(['Thành viên', 'Nhóm', 'Nhân lực']);
    expect(screen.getByRole('tab', { name: 'Thành viên' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('?tab=resources mở thẳng tab Nhân lực (liên kết cũ /manage/resources chuyển về đây)', async () => {
    renderAt('/members?tab=resources');
    expect(screen.getByRole('tab', { name: 'Nhân lực' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/resources/workload', expect.anything()),
    );
    // Nội dung của màn Nhân lực cũ: các tab con và bộ lọc theo tuần.
    expect(screen.getByRole('tab', { name: 'Khối lượng theo tuần' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Phân bổ' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Nghỉ phép & ngày lễ' })).toBeTruthy();
    // Không còn nút "Mời thành viên" ở tab này.
    expect(screen.queryByRole('button', { name: /Mời thành viên/ })).toBeNull();
  });

  it('bấm tab Nhân lực ghi ?tab=resources vào URL; về Thành viên thì bỏ tham số', async () => {
    const user = renderAt('/members');
    await user.click(screen.getByRole('tab', { name: 'Nhân lực' }));
    expect(screen.getByTestId('where').textContent).toBe('/members?tab=resources');
    await user.click(screen.getByRole('tab', { name: 'Thành viên' }));
    expect(screen.getByTestId('where').textContent).toBe('/members');
  });

  it('?tab= lạ → tab Thành viên', () => {
    renderAt('/members?tab=zzz');
    expect(screen.getByRole('tab', { name: 'Thành viên' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('chỉ có organization:view + report:view (đến từ liên kết ở Tổng quan): bảng Nhân lực hiện, không nút quản lý, không lỗi', async () => {
    h.get.mockImplementation((url: string) => {
      if (url === '/resources/workload')
        return Promise.resolve({
          data: {
            from: '2026-11-02',
            to: '2026-11-15',
            projectId: null,
            hoursPerDay: 8,
            weeks: [{ start: '2026-11-02', end: '2026-11-08', label: '02/11' }],
            rows: [
              {
                user: { id: 'u2', email: 'a@x', displayName: 'Nguyễn An', avatarUrl: null },
                weeks: [
                  {
                    weekStart: '2026-11-02',
                    capacityHours: 40,
                    assignedHours: 52,
                    loggedHours: 0,
                    workingDays: 5,
                    offDays: 0,
                    allocationPercent: 100,
                    issueCount: 3,
                    ratio: 1.3,
                    overloaded: true,
                  },
                ],
                totals: {
                  capacityHours: 40,
                  assignedHours: 52,
                  loggedHours: 0,
                  ratio: 1.3,
                  overloaded: true,
                },
                usesDefaultCapacity: true,
              },
            ],
          },
        });
      return Promise.resolve({ data: [] });
    });
    renderAt('/members?tab=resources', {
      admin: false,
      permissions: ['organization:view', 'report:view'],
    });
    expect(screen.getByRole('tab', { name: 'Nhân lực' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await screen.findByText('Nguyễn An')).toBeTruthy();
    expect(screen.getByText(/1 người/)).toBeTruthy();
    // Không có lối quản lý thành viên / nhân lực.
    expect(screen.queryByRole('button', { name: /Mời thành viên|Thêm nhiều người/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Không tải được|403/)).toBeNull();
    // Tab Phân bổ (chỉ đọc): không có nút thêm.
    expect(screen.queryByRole('button', { name: /Thêm phân bổ/ })).toBeNull();
  });
});
