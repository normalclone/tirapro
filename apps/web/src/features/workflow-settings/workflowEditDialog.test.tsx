// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import tira from './tiraWorkflow.fixture.json';
import type { Workflow } from './api';

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

import { useAuth } from '@/stores/auth';
import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { WorkflowSettingsPage } from './WorkflowSettingsPage';

const wf = {
  id: 'wf1',
  name: 'Quy trình TIRA',
  description: null,
  isTemplate: false,
  isDefault: true,
  projectId: 'p1',
  usedBy: {
    scheme: [],
    overrides: [],
    projects: [{ id: 'p1', key: 'TIRA', name: 'Tirapro', deleted: false }],
    hiddenOverrideCount: 0,
  },
  ...tira,
} as unknown as Workflow;
const wf2 = {
  ...wf,
  id: 'wf2',
  name: 'Quy trình phụ',
  isDefault: false,
  usedBy: { scheme: [], overrides: [], projects: [], hiddenOverrideCount: 0 },
} as Workflow;

function renderPage(url = '/settings/workflows', admin = true) {
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'u', isSystemAdmin: admin } as never,
      permissions: [],
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <WorkflowSettingsPage />
        <ConfirmHost />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const row = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
    writable: true,
  });
  useConfirmStore.setState({ open: false, opts: null, resolve: null });
  h.get.mockReset();
  h.get.mockImplementation((url: string) =>
    url.startsWith('/workflows')
      ? Promise.resolve({ data: [wf, wf2] })
      : Promise.resolve({ data: [] }),
  );
});
afterEach(cleanup);

describe('Quy trình: sửa trong hộp thoại, không mở rộng bên dưới', () => {
  it('hàng là nút thường (không chevron, không aria-expanded); bấm mở hộp thoại có tab Sơ đồ/Danh sách và sơ đồ', async () => {
    const user = renderPage();
    const r = await row('Quy trình TIRA');
    expect(r.hasAttribute('aria-expanded')).toBe(false);
    expect(r.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(r);
    const dialog = await screen.findByRole('dialog', { name: /Quy trình TIRA/ });
    expect(within(dialog).getByRole('radio', { name: 'Sơ đồ' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Danh sách' })).toBeTruthy();
    expect(within(dialog).getByText('Mặc định')).toBeTruthy(); // huy hiệu cạnh tên
    // Không có gì dựng ra bên dưới danh sách: tab chỉ tồn tại trong hộp thoại
    expect(screen.getAllByRole('radio', { name: 'Sơ đồ' })).toHaveLength(1);
    await user.click(within(dialog).getByRole('radio', { name: 'Danh sách' }));
    expect(await within(dialog).findByText('Trạng thái')).toBeTruthy();
  });

  it('Esc đóng hộp thoại và trả focus về đúng hàng', async () => {
    const user = renderPage();
    const r = await row('Quy trình phụ');
    await user.click(r);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(r));
  });

  it('?workflow=<id> mở thẳng hộp thoại của quy trình đó khi tải trang', async () => {
    renderPage('/settings/workflows?workflow=wf2');
    const dialog = await screen.findByRole('dialog', { name: /Quy trình phụ/ });
    expect(dialog).toBeTruthy();
  });

  it('?workflow=<id không tồn tại> không mở gì', async () => {
    renderPage('/settings/workflows?workflow=ghost');
    await row('Quy trình TIRA');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('người chỉ xem: cùng hộp thoại ở chế độ xem (không có nút thêm trạng thái)', async () => {
    const user = renderPage('/settings/workflows', false);
    await user.click(await row('Quy trình TIRA'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Danh sách' }));
    await within(dialog).findByText('Trạng thái');
    expect(within(dialog).queryByRole('button', { name: /Thêm trạng thái/ })).toBeNull();
  });

  it('có nội dung chưa lưu (đang gõ tên trạng thái mới): đóng hỏi trước (Esc trong ô nhập chỉ huỷ form); Huỷ thì ở nguyên, Bỏ thì đóng', async () => {
    const user = renderPage();
    await user.click(await row('Quy trình TIRA'));
    const dialog = await screen.findByRole('dialog', { name: /Quy trình TIRA/ });
    await user.click(within(dialog).getByRole('radio', { name: 'Danh sách' }));
    await within(dialog).findByText('Trạng thái');
    await user.click(await within(dialog).findByRole('button', { name: /Thêm trạng thái/ }));
    await user.type(within(dialog).getByLabelText('Tên'), 'Đang xem xét');
    // Esc trong ô nhập: chỉ huỷ form đang nhập, chưa hỏi và chưa đóng hộp thoại
    await user.keyboard('{Escape}');
    expect(within(dialog).queryByLabelText('Tên')).toBeNull();
    expect(screen.queryByRole('dialog', { name: /Bỏ thay đổi/ })).toBeNull();
    expect(screen.getByRole('dialog', { name: /Quy trình TIRA/ })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Thêm trạng thái/ }));
    await user.type(within(dialog).getByLabelText('Tên'), 'Đang xem xét');
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    const confirm = await screen.findByRole('dialog', { name: /Bỏ thay đổi chưa lưu/ });
    await user.click(within(confirm).getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Bỏ thay đổi/ })).toBeNull());
    expect(screen.getByRole('dialog', { name: /Quy trình TIRA/ })).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
    const confirm2 = await screen.findByRole('dialog', { name: /Bỏ thay đổi chưa lưu/ });
    await user.click(within(confirm2).getByRole('button', { name: /Bỏ thay đổi/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('không có gì chưa lưu: đóng thẳng, không hỏi', async () => {
    const user = renderPage();
    await user.click(await row('Quy trình TIRA'));
    const dialog = await screen.findByRole('dialog', { name: /Quy trình TIRA/ });
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
