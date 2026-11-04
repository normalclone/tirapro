// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: h.get, post: h.post, patch: h.patch, put: vi.fn(), delete: vi.fn() },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
// Hạ tầng realtime/socket không liên quan tới bài kiểm tra
vi.mock('@/lib/socket', () => {
  const fake = { on: () => fake, off: () => fake, emit: () => fake, connected: false };
  return {
    getSocket: () => fake,
    acquireRoom: () => () => undefined,
    useConnectionState: () => 'connected',
    reconnectSocket: () => undefined,
    disconnectSocket: () => undefined,
  };
});

import { useAuth } from '@/stores/auth';
import { IssueDetailPage } from './IssueDetailPage';

const BUG: IssueDto['type'] = {
  id: 'bt',
  name: 'Bug',
  key: 'BUG',
  iconUrl: null,
  color: null,
  hierarchyLevel: 0,
  isSubtask: false,
};

const issue = (o: Partial<IssueDto> = {}): IssueDto =>
  mk('b1', {
    key: 'BUG-1',
    type: BUG,
    summary: 'Lỗi đăng nhập',
    acceptanceCriteria: null,
    components: [],
    fixVersions: [],
    environment: null,
    labels: [],
    version: 1,
    ...o,
  });

function mockApi(i: IssueDto) {
  h.get.mockImplementation((url: string) => {
    if (url === `/issues/${i.key}`) return Promise.resolve({ data: i });
    if (url.endsWith('/checklist') || url.endsWith('/links') || url.startsWith('/wiki/by-issue/'))
      return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`offline ${url}`));
  });
}

function renderPage(i: IssueDto, editor = true, permissions: string[] = []) {
  mockApi(i);
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: {
        id: 'u',
        displayName: 'Tôi',
        email: 'u@x.vn',
        avatarUrl: null,
        isSystemAdmin: editor,
      } as never,
      permissions: permissions as never,
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/issue/${i.key}`]}>
        <Routes>
          <Route path="/issue/:key" element={<IssueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  for (const [name, value] of [
    ['scrollIntoView', () => undefined],
    ['hasPointerCapture', () => false],
  ] as const)
    Object.defineProperty(Element.prototype, name, { value, configurable: true, writable: true });
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  globalThis.IntersectionObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
    takeRecords = () => [];
  } as never;
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
  h.patch.mockResolvedValue({ data: { id: 'b1', version: 2 } });
});
afterEach(cleanup);

describe('thanh thao tác của trang việc: "Tạo bản sao" nằm trong menu "Thêm"', () => {
  it('không còn nút "Tạo bản sao" riêng; mở "Thêm" thấy mục này ĐẦU TIÊN; bấm → tạo bản sao (cùng luồng cũ)', async () => {
    h.post.mockImplementation((_u: string, body: object) =>
      Promise.resolve({ data: { ...issue(), id: 'b2', key: 'BUG-2', ...body } }),
    );
    const user = renderPage(issue({ difficulty: 'HARD' }));
    const more = await screen.findByRole('button', { name: /Thêm$/ }, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: /Tạo bản sao/ })).toBeNull();
    await user.click(more);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]!.textContent?.trim()).toBe('Tạo bản sao');
    await user.click(items[0]!);
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    const [url, body] = h.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/issues');
    expect(body).toMatchObject({
      summary: 'Lỗi đăng nhập (bản sao)',
      difficulty: 'HARD',
      projectId: 'p',
    });
    expect(body).not.toHaveProperty('storyPoints'); // điểm do máy chủ tính, không gửi
  });

  it('thiếu quyền tạo việc: menu "Thêm" không có "Tạo bản sao"', async () => {
    const user = renderPage(issue(), false);
    await screen.findByText('Lỗi đăng nhập', {}, { timeout: 4000 });
    const more = screen.queryByRole('button', { name: /Thêm$/ });
    if (more) {
      await user.click(more);
      const menu = await screen.findByRole('menu');
      expect(within(menu).queryByRole('menuitem', { name: 'Tạo bản sao' })).toBeNull();
    }
  });
});

describe('trang việc đầy đủ lấp đầy vùng nội dung', () => {
  it('khung gốc của trang không còn lớp max-w-* hẹp (nội dung trải theo bề ngang vùng làm việc)', async () => {
    renderPage(issue());
    const title = await screen.findByText('Lỗi đăng nhập', {}, { timeout: 4000 });
    const frame = title.closest('div.mx-auto')!;
    expect(frame).toBeTruthy();
    expect(frame.className).not.toMatch(/max-w-/);
    expect(frame.className).toContain('w-full');
    // vẫn giữ đệm ngang chuẩn của trang
    expect(frame.className).toMatch(/px-4/);
  });
});

describe('phím tắt `i` (gán cho tôi) cùng điều kiện với nút: cần cả issue:assign lẫn quyền sửa', () => {
  const base = ['issue:view', 'project:view', 'issue:edit'];

  it('chỉ có quyền sửa, thiếu issue:assign: bấm i không gửi gì', async () => {
    const user = renderPage(issue({ assigneeId: null, assignee: null }), false, base);
    await screen.findByText('Lỗi đăng nhập');
    await user.keyboard('i');
    await new Promise((r) => setTimeout(r, 50));
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('đủ issue:assign + quyền sửa: bấm i gửi { assigneeId, version }', async () => {
    const user = renderPage(issue({ assigneeId: null, assignee: null }), false, [
      ...base,
      'issue:assign',
    ]);
    await screen.findByText('Lỗi đăng nhập');
    await user.keyboard('i');
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch).toHaveBeenCalledWith('/issues/b1', { assigneeId: 'u', version: 1 });
  });
});
