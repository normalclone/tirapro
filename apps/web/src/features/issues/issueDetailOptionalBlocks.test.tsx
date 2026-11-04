// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: h.get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
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

function renderPage(i: IssueDto, editor = true) {
  mockApi(i);
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'u', isSystemAdmin: editor } as never,
      permissions: [],
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
});
afterEach(cleanup);

describe('trang việc: khối tuỳ chọn ẩn sau "+ Thêm mục" (trang thật)', () => {
  it('Bug rỗng: không có 8 khối, Mô tả vẫn có, nút "+ Thêm mục"; chọn "Liên kết" thì khối hiện', async () => {
    const user = renderPage(issue());
    const add = await screen.findByRole('button', { name: /Thêm mục/ }, { timeout: 4000 });
    expect(screen.getByText('Mô tả')).toBeTruthy();
    for (const t of [
      'Tiêu chí chấp nhận',
      'Các bước cần làm',
      'Sửa ở phiên bản',
      'Bị ảnh hưởng ở phiên bản',
      'Tài liệu liên quan',
      'Thêm thông tin môi trường',
    ])
      expect(screen.queryByText(t), t).toBeNull();
    await user.click(add);
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Liên kết' }));
    // khối hiện và vào thẳng chế độ thêm (form mở sẵn: có nút Đóng, không còn nút "Thêm liên kết")
    await waitFor(() => expect(screen.getByText('Liên kết (0)')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thêm liên kết/ })).toBeNull();
  });

  it('việc có tiêu chí chấp nhận: khối hiện sẵn', async () => {
    renderPage(issue({ acceptanceCriteria: '- [ ] Đăng nhập được' }));
    expect(await screen.findByText('Tiêu chí chấp nhận', {}, { timeout: 4000 })).toBeTruthy();
  });

  it('người chỉ xem không thấy nút', async () => {
    renderPage(issue(), false);
    await screen.findByText('Lỗi đăng nhập', {}, { timeout: 4000 });
    expect(screen.queryByRole('button', { name: /Thêm mục/ })).toBeNull();
  });
});
