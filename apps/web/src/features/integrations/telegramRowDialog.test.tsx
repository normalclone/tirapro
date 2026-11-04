// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import type { Integration } from './api';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { TelegramRow } from './TelegramSection';

const integration = {
  id: 'i1',
  type: 'TELEGRAM',
  name: 'Bot nhóm dev',
  status: 'ACTIVE',
  config: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  botUsername: 'dev_bot',
  health: { state: 'READY', hint: '' },
  lastTest: null,
} as unknown as Integration;

function setup(canManage = true) {
  const onContinue = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ul>
        <TelegramRow
          integration={integration}
          canManage={canManage}
          onDelete={vi.fn()}
          deleting={false}
          onContinue={onContinue}
        />
      </ul>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onContinue };
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    value: () => false,
    configurable: true,
    writable: true,
  });
  h.get.mockReset();
  h.get.mockResolvedValue({
    data: [{ id: 'c1', externalId: '-100123', title: 'Nhóm dev', events: [] }],
  });
});
afterEach(cleanup);

describe('Kết nối Telegram: kênh nhận thông báo sửa trong hộp thoại', () => {
  it('bấm hàng mở hộp thoại có danh sách kênh; không dựng gì bên dưới hàng; không còn aria-expanded', async () => {
    const { user } = setup();
    const row = screen.getByRole('button', { name: /^Bot nhóm dev/ });
    expect(row.hasAttribute('aria-expanded')).toBe(false);
    expect(screen.queryByText('Kênh nhận thông báo')).toBeNull();
    await user.click(row);
    const dialog = await screen.findByRole('dialog', { name: /^Bot nhóm dev/ });
    expect(await within(dialog).findByText('Nhóm dev')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Thêm nhóm bằng mã/ })).toBeTruthy();
    expect(screen.getAllByText('Kênh nhận thông báo')).toHaveLength(1);
  });

  it('Esc đóng và trả focus về hàng', async () => {
    const { user } = setup();
    const row = screen.getByRole('button', { name: /^Bot nhóm dev/ });
    await user.click(row);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('"Thêm nhóm bằng mã" đóng hộp thoại rồi chuyển sang trình hướng dẫn', async () => {
    const { user, onContinue } = setup();
    await user.click(screen.getByRole('button', { name: /^Bot nhóm dev/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Thêm nhóm bằng mã/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('người chỉ xem: hàng không bấm được', () => {
    setup(false);
    const row = screen.getByRole('button', { name: /^Bot nhóm dev/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
  });
});
