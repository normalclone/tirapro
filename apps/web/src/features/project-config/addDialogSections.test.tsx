// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import { toast } from 'sonner';
import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { LabelsSection } from './LabelsSection';
import { ComponentsSection } from './ComponentsSection';

function setup(ui: JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      {ui}
      <ConfirmHost />
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
  vi.mocked(toast.success).mockClear();
  h.get.mockReset();
  h.post.mockReset();
  h.get.mockResolvedValue({
    data: [{ id: 'l1', name: 'cũ', color: '#3b82f6', description: null }],
  });
  h.post.mockResolvedValue({ data: { id: 'l2', name: 'mới', color: '#3b82f6' } });
  act(() => undefined);
});
afterEach(cleanup);

describe('Cấu hình dự án: "Thêm …" mở hộp thoại, không còn form mở bung dưới danh sách', () => {
  it('Nhãn: nút "Thêm nhãn", bấm mở hộp thoại; gửi đúng yêu cầu cũ, đóng hộp thoại và báo toast', async () => {
    const user = setup(<LabelsSection projectId="p1" canAdmin />);
    const btn = await screen.findByRole('button', { name: /Thêm nhãn/ });
    expect(screen.queryByLabelText('Tên')).toBeNull(); // không có form trên trang
    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm nhãn' });
    await user.type(within(dialog).getByLabelText('Tên'), 'mới');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith(
        '/projects/p1/labels',
        expect.objectContaining({ name: 'mới' }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Đã thêm nhãn');
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('Nhãn: đang nhập dở rồi đóng thì hỏi; không có quyền thì không có nút', async () => {
    const user = setup(<LabelsSection projectId="p1" canAdmin />);
    await user.click(await screen.findByRole('button', { name: /Thêm nhãn/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm nhãn' });
    await user.type(within(dialog).getByLabelText('Tên'), 'dở');
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByRole('dialog', { name: /Bỏ thay đổi chưa lưu/ })).toBeTruthy();
    cleanup();
    setup(<LabelsSection projectId="p1" canAdmin={false} />);
    await screen.findByText('cũ');
    expect(screen.queryByRole('button', { name: /Thêm nhãn/ })).toBeNull();
  });

  it('Thành phần: cùng mẫu — nút mở hộp thoại có tên + mô tả, gửi đúng yêu cầu cũ', async () => {
    h.get.mockResolvedValue({ data: [{ id: 'c1', name: 'API', description: null }] });
    h.post.mockResolvedValue({ data: { id: 'c2', name: 'Web' } });
    const user = setup(<ComponentsSection projectId="p1" canAdmin />);
    await user.click(await screen.findByRole('button', { name: /Thêm thành phần/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm thành phần' });
    await user.type(within(dialog).getByLabelText('Tên'), 'Web');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(String(h.post.mock.calls[0]![0])).toBe('/projects/p1/components');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
