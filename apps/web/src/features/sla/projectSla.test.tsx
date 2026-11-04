// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: h.post, put: h.put, delete: vi.fn() } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useAuth } from '@/stores/auth';
import { ConfigSection } from '@/features/project-config/ProjectConfigPage';

const project = (id: string, key: string, name: string, over: Partial<ProjectDto> = {}) =>
  ({ id, key, name, archivedAt: null, programs: [], ...over }) as ProjectDto;
const PA = project('pa', 'AAA', 'Alpha');
const PB = project('pb', 'BBB', 'Beta');
const ROW = {
  issueId: 'i1',
  key: 'AAA-1',
  summary: 'Lỗi đăng nhập',
  status: { name: 'Đang làm', category: 'IN_PROGRESS' },
  assignee: null,
  priority: null,
  policyName: 'Gói khẩn',
  resolveDueAt: '2026-11-05T10:00:00Z',
  remainingMins: 60,
  responded: false,
  responseBreached: false,
  resolveBreached: false,
};
const POLICY = {
  id: 's1',
  name: 'Hỗ trợ tiêu chuẩn',
  projectId: 'pa',
  project: { id: 'pa', key: 'AAA', name: 'Alpha' },
  priorityId: null,
  priority: null,
  responseMins: 240,
  resolveMins: 1440,
  active: true,
};

/** Quyền dự án theo id (GET /projects/:id/permissions/me). */
let projectPerms: Record<string, string[]> = {};

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  h.put.mockReset();
  projectPerms = {};
  h.get.mockImplementation((url: string) => {
    if (url === '/projects/AAA') return Promise.resolve({ data: PA });
    if (url === '/projects/BBB') return Promise.resolve({ data: PB });
    if (url === '/projects') return Promise.resolve({ data: [PA, PB] });
    const m = /^\/projects\/(\w+)\/permissions\/me$/.exec(url);
    if (m) {
      return Promise.resolve({
        data: { projectId: m[1], permissions: projectPerms[m[1]!] ?? [] },
      });
    }
    if (url === '/sla/policies') return Promise.resolve({ data: [POLICY] });
    if (url === '/sla/board') return Promise.resolve({ data: [ROW] });
    return Promise.resolve({ data: [] });
  });
  h.post.mockResolvedValue({ data: [] });
  useAuth.setState({ user: { id: 'me', isSystemAdmin: false } as never, permissions: [] });
});
afterEach(cleanup);

function renderTab(key: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/p/${key}/config/response-time`]}>
        <Routes>
          <Route path="/p/:key/config/:section" element={<ConfigSection />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const addBtn = () => screen.queryByRole('button', { name: /Thêm cam kết/ });

async function settle(projectId: string) {
  await waitFor(() => expect(h.get).toHaveBeenCalledWith(`/projects/${projectId}/permissions/me`));
  await screen.findByText('Hỗ trợ tiêu chuẩn');
  await new Promise((r) => setTimeout(r, 50));
}

describe('Cấu hình dự án > Thời gian xử lý (cam kết + bảng theo dõi)', () => {
  it('tải cam kết và bảng theo dõi CỦA dự án đang mở (?projectId=), tiêu đề h2', async () => {
    renderTab('AAA');
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/sla/policies', { params: { projectId: 'pa' } }),
    );
    expect(h.get).toHaveBeenCalledWith('/sla/board', { params: { projectId: 'pa' } });
    expect(screen.getByRole('heading', { level: 2, name: 'Thời gian xử lý' })).toBeTruthy();
    expect(await screen.findByText('Hỗ trợ tiêu chuẩn')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Đang chạy đồng hồ' })).toBeTruthy();
    expect(screen.getByText('Lỗi đăng nhập')).toBeTruthy();
    // Không còn cam kết "mọi dự án".
    expect(screen.queryByText('Mọi dự án')).toBeNull();
  });

  describe('quyền tạo/sửa: sla:manage cấp tổ chức HOẶC quản trị chính dự án', () => {
    it('có sla:manage cấp tổ chức → thấy nút Thêm cam kết', async () => {
      useAuth.setState({ permissions: ['sla:manage'] });
      renderTab('AAA');
      expect(await screen.findByRole('button', { name: /Thêm cam kết/ })).toBeTruthy();
    });

    it('chỉ là quản trị dự án này (project:admin) → thấy nút', async () => {
      projectPerms = { pa: ['project:admin'] };
      renderTab('AAA');
      expect(await screen.findByRole('button', { name: /Thêm cam kết/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Tắt cam kết Hỗ trợ tiêu chuẩn' })).toBeTruthy();
    });

    it('quản trị dự án A KHÔNG quản được cam kết của dự án B', async () => {
      projectPerms = { pa: ['project:admin'], pb: ['project:view'] };
      renderTab('BBB');
      await settle('pb');
      expect(addBtn()).toBeNull();
      expect(screen.queryByRole('button', { name: /^Tắt cam kết/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Xoá cam kết/ })).toBeNull();
    });

    it('không có quyền nào → chỉ đọc', async () => {
      projectPerms = { pa: ['project:view'] };
      renderTab('AAA');
      await settle('pa');
      expect(addBtn()).toBeNull();
    });
  });

  it('thêm cam kết luôn gắn dự án hiện tại (không có ô chọn dự án)', async () => {
    projectPerms = { pa: ['project:admin'] };
    const user = renderTab('AAA');
    await user.click(await screen.findByRole('button', { name: /Thêm cam kết/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Mọi dự án/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Dự án' })).toBeNull();
    await user.type(within(dialog).getByLabelText('Tên cam kết'), 'Khẩn cấp');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo cam kết' }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post.mock.calls[0]![0]).toBe('/sla/policies');
    expect(h.post.mock.calls[0]![1]).toMatchObject({ name: 'Khẩn cấp', projectId: 'pa' });
  });
});
