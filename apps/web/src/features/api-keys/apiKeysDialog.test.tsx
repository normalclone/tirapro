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
import { ApiKeysPage } from './ApiKeysPage';

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
  h.get.mockResolvedValue({ data: { data: [] } });
  h.post.mockResolvedValue({
    data: { id: 'k1', name: 'n8n', key: 'tp_secret_123', prefix: 'tp_sec', canWrite: false },
  });
  act(() => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'u', isSystemAdmin: true } as never,
      permissions: [],
    });
  });
});
afterEach(cleanup);

describe('API & kết nối lập trình: "Tạo khoá" mở hộp thoại', () => {
  it('trang không có form tạo mở sẵn; nút Tạo khoá ở đầu trang mở hộp thoại; gửi xong hiện khoá một lần', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ApiKeysPage />
          <ConfirmHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const btn = (await screen.findAllByRole('button', { name: /Tạo khoá/ }))[0]!;
    expect(screen.queryByLabelText('Tên khoá')).toBeNull();
    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Tạo khoá API' });
    await user.type(within(dialog).getByLabelText('Tên khoá'), 'n8n');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo khoá' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
    expect(h.post.mock.calls[0]![1]).toMatchObject({ name: 'n8n' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('tp_secret_123')).toBeTruthy();
  });
});
