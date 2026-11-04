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
import { RaidPage } from './RaidPage';

const project = (id: string, key: string, name: string, over: Partial<ProjectDto> = {}) =>
  ({ id, key, name, archivedAt: null, programs: [], ...over }) as ProjectDto;
const PA = project('pa', 'AAA', 'Alpha');
const PB = project('pb', 'BBB', 'Beta');

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
    return Promise.resolve({ data: [] });
  });
  h.post.mockResolvedValue({ data: { id: 'g1' } });
  useAuth.setState({ user: { id: 'me', isSystemAdmin: false } as never, permissions: [] });
});
afterEach(cleanup);

function renderTab(key: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/p/${key}/risks`]}>
        <Routes>
          <Route path="/p/:key/risks" element={<RaidPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** Chờ quyền dự án tải xong và React áp xong (để khẳng định "không có nút" không đúng vì chưa kịp tải). */
async function settle(projectId: string) {
  await waitFor(() => expect(h.get).toHaveBeenCalledWith(`/projects/${projectId}/permissions/me`));
  await screen.findByText(/Chưa có rủi ro nào/);
  await new Promise((r) => setTimeout(r, 50));
}

const createBtn = () => screen.queryByRole('button', { name: /Thêm rủi ro/ });

describe('tab Rủi ro & vướng mắc của dự án', () => {
  it('chỉ tải rủi ro của dự án đang mở và không còn bộ lọc dự án', async () => {
    renderTab('AAA');
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/raid', { params: { kind: 'RISK', projectId: 'pa' } }),
    );
    expect(
      h.get.mock.calls
        .filter((c) => c[0] === '/raid')
        .every((c) => (c[1] as { params: { projectId: string } }).params.projectId === 'pa'),
    ).toBe(true);
    expect(screen.getByRole('heading', { name: 'Rủi ro & vướng mắc' }).tagName).toBe('H2');
    expect(screen.getByRole('button', { name: 'Lọc theo trạng thái' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lọc theo dự án' })).toBeNull();
  });

  describe('quyền tạo/sửa: quyền cấp tổ chức HOẶC quản trị chính dự án', () => {
    it('có risk:manage cấp tổ chức → thấy nút Thêm rủi ro', async () => {
      useAuth.setState({ permissions: ['risk:manage'] });
      renderTab('AAA');
      expect(
        (await screen.findAllByRole('button', { name: /Thêm rủi ro/ })).length,
      ).toBeGreaterThan(0);
    });

    it('chỉ là quản trị dự án này (project:admin) → thấy nút', async () => {
      projectPerms = { pa: ['project:admin'] };
      renderTab('AAA');
      expect(
        (await screen.findAllByRole('button', { name: /Thêm rủi ro/ })).length,
      ).toBeGreaterThan(0);
    });

    it('quản trị dự án A KHÔNG quản được rủi ro của dự án B', async () => {
      projectPerms = { pa: ['project:admin'], pb: ['project:view'] };
      renderTab('BBB');
      await settle('pb');
      expect(createBtn()).toBeNull();
    });

    it('không có quyền nào → không có nút tạo; dự án đã lưu trữ → chỉ đọc kể cả khi có quyền', async () => {
      projectPerms = { pa: ['project:view'] };
      renderTab('AAA');
      await settle('pa');
      expect(createBtn()).toBeNull();
      cleanup();

      h.get.mockImplementation((url: string) =>
        url === '/projects/AAA'
          ? Promise.resolve({ data: { ...PA, archivedAt: '2026-01-01T00:00:00Z' } })
          : url === '/projects'
            ? Promise.resolve({ data: [PA] })
            : Promise.resolve({
                data: url.includes('permissions')
                  ? { projectId: 'pa', permissions: ['project:admin'] }
                  : [],
              }),
      );
      useAuth.setState({ permissions: ['risk:manage'] });
      renderTab('AAA');
      await settle('pa');
      expect(createBtn()).toBeNull();
    });
  });

  it('tạo rủi ro luôn gắn dự án hiện tại (không có ô chọn dự án)', async () => {
    projectPerms = { pa: ['project:admin'] };
    const user = renderTab('AAA');
    const open = (await screen.findAllByRole('button', { name: /Thêm rủi ro/ }))[0]!;
    await user.click(open);
    const dialog = await screen.findByRole('dialog');
    // Dự án hiện ở dạng chữ cố định, không phải ô chọn.
    expect(within(dialog).getByText('Alpha')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Dự án' })).toBeNull();
    await user.type(within(dialog).getByLabelText('Tiêu đề'), 'Máy chủ quá tải lúc ra mắt');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm rủi ro' }));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post.mock.calls[0]![0]).toBe('/raid');
    expect(h.post.mock.calls[0]![1]).toMatchObject({
      title: 'Máy chủ quá tải lúc ra mắt',
      projectId: 'pa',
    });
  });
});
