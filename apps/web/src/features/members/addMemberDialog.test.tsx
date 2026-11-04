// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: h.get, post: h.post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { useAuth } from '@/stores/auth';
import { MembersPage } from './MembersPage';

const ROLE = {
  id: 'r-member',
  name: 'Workspace Member',
  color: null,
  scope: 'WORKSPACE',
  isSystem: true,
  permissionKeys: [],
};

function renderPage(admin = true) {
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'me', displayName: 'Tôi', email: 'me@x', isSystemAdmin: admin } as never,
      permissions: [],
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MembersPage />
        <ConfirmHost />
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
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  } as never;
  useConfirmStore.setState({ open: false, opts: null, resolve: null });
  h.get.mockReset();
  h.post.mockReset();
  h.get.mockImplementation((url: string) => {
    if (url.startsWith('/roles')) return Promise.resolve({ data: [ROLE] });
    if (url.startsWith('/members')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  h.post.mockResolvedValue({
    data: {
      member: { user: { id: 'n1', displayName: 'Nguyễn An', email: 'an@x.vn' } },
      tempPassword: 'Tam-Pass-123',
    },
  });
});
afterEach(cleanup);

describe('Thành viên: mời thành viên bằng hộp thoại, không còn form mở sẵn', () => {
  it('trang có nút "Mời thành viên", không có form thêm trên trang; bấm mở hộp thoại có form', async () => {
    const user = renderPage();
    const btn = await screen.findAllByRole('button', { name: /Mời thành viên/ });
    expect(btn.length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Chọn người để thêm vào tổ chức')).toBeNull();
    await user.click(btn[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Mời thành viên' });
    expect(
      within(dialog).getByRole('button', { name: /Chọn người để thêm vào tổ chức/ }),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Tạo tài khoản mới/ })).toBeTruthy();
  });

  it('tạo tài khoản: gửi đúng yêu cầu như cũ, hiện mật khẩu tạm một lần; "Xong" đóng hộp thoại', async () => {
    const user = renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Mời thành viên/ }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Mời thành viên' });
    await user.click(within(dialog).getByRole('button', { name: /Tạo tài khoản mới/ }));
    await user.type(within(dialog).getByPlaceholderText('ten@congty.com'), 'an@x.vn');
    await user.type(within(dialog).getByPlaceholderText('Nguyễn Văn A'), 'Nguyễn An');
    await user.click(within(dialog).getByRole('button', { name: /Tạo tài khoản và thêm/ }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post).toHaveBeenCalledWith('/members/accounts', {
      email: 'an@x.vn',
      displayName: 'Nguyễn An',
      roleIds: ['r-member'],
      password: undefined,
    });
    expect(await within(dialog).findByDisplayValue('Tam-Pass-123')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Xong' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Esc khi chưa nhập gì đóng thẳng và trả focus về nút; đang nhập dở thì hỏi trước', async () => {
    const user = renderPage();
    const btn = (await screen.findAllByRole('button', { name: /Mời thành viên/ }))[0]!;
    await user.click(btn);
    await screen.findByRole('dialog', { name: 'Mời thành viên' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));

    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Mời thành viên' });
    await user.click(within(dialog).getByRole('button', { name: /Tạo tài khoản mới/ }));
    await user.type(within(dialog).getByPlaceholderText('ten@congty.com'), 'dang@go.vn');
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    const confirm = await screen.findByRole('dialog', { name: /Bỏ thay đổi chưa lưu/ });
    await user.click(within(confirm).getByRole('button', { name: 'Huỷ' }));
    expect(screen.getByRole('dialog', { name: 'Mời thành viên' })).toBeTruthy();
    await user.click(
      within(screen.getByRole('dialog', { name: 'Mời thành viên' })).getByRole('button', {
        name: 'Đóng',
      }),
    );
    const confirm2 = await screen.findByRole('dialog', { name: /Bỏ thay đổi chưa lưu/ });
    await user.click(within(confirm2).getByRole('button', { name: /Bỏ thay đổi/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.post).not.toHaveBeenCalled();
  });

  it('đóng khi mật khẩu tạm còn hiện: lời hỏi nói rõ mật khẩu sẽ không hiện lại (không phải "nhập dở")', async () => {
    const user = renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Mời thành viên/ }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Mời thành viên' });
    await user.click(within(dialog).getByRole('button', { name: /Tạo tài khoản mới/ }));
    await user.type(within(dialog).getByPlaceholderText('ten@congty.com'), 'an@x.vn');
    await user.type(within(dialog).getByPlaceholderText('Nguyễn Văn A'), 'Nguyễn An');
    await user.click(within(dialog).getByRole('button', { name: /Tạo tài khoản và thêm/ }));
    await within(dialog).findByDisplayValue('Tam-Pass-123');
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    const confirm = await screen.findByRole('dialog', { name: /Mật khẩu tạm sẽ không hiện lại/ });
    expect(within(confirm).getByText(/Bạn đã chép lại chưa\?/)).toBeTruthy();
    expect(within(confirm).queryByText(/nhập dở/)).toBeNull();
    await user.click(within(confirm).getByRole('button', { name: 'Huỷ' }));
    expect(screen.getByRole('dialog', { name: 'Mời thành viên' })).toBeTruthy();
    await user.click(
      within(screen.getByRole('dialog', { name: 'Mời thành viên' })).getByRole('button', {
        name: 'Đóng',
      }),
    );
    const confirm2 = await screen.findByRole('dialog', { name: /Mật khẩu tạm sẽ không hiện lại/ });
    await user.click(within(confirm2).getByRole('button', { name: /Đã chép, đóng/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('không có quyền member:manage: không có nút', async () => {
    renderPage(false);
    await screen.findByText('Danh sách thành viên');
    expect(screen.queryByRole('button', { name: /Mời thành viên/ })).toBeNull();
  });
});
