// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriageItemDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { TriageRow } from './TriageRow';

const base = mk('t1', { key: 'TIRA-7', summary: 'Nút lưu không bấm được' });
const issue = {
  ...base,
  description: 'Bấm **Lưu** không có phản hồi.',
  reporter: null,
  kind: null,
  environment: null,
  severity: null,
  sprintId: null,
  occurrenceCount: 1,
  lastOccurredAt: null,
  triageState: null,
  triageSnoozeUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as TriageItemDto;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ul>
          <TriageRow
            issue={issue}
            projectKey="TIRA"
            compact={false}
            peeking={false}
            canTriage
            pending={false}
            onPeek={vi.fn()}
            onAccept={vi.fn()}
            onDecline={vi.fn()}
            onSnooze={vi.fn()}
          />
        </ul>
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
  h.get.mockReset();
  h.get.mockResolvedValue({ data: [] });
});
afterEach(cleanup);

describe('Việc mới vào: chi tiết mở trong hộp thoại, dòng không giãn ra', () => {
  it('nút "Chi tiết" mở hộp thoại có mô tả và nút Nhận…; dòng không có aria-expanded/vùng mở rộng', async () => {
    const user = setup();
    const btn = screen.getByRole('button', { name: 'Chi tiết TIRA-7' });
    expect(btn.hasAttribute('aria-expanded')).toBe(false);
    expect(screen.queryByRole('region', { name: /Chi tiết/ })).toBeNull();
    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: /TIRA-7/ });
    expect(within(dialog).getByText(/không có phản hồi/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Nhận…/ })).toBeTruthy();
    // dòng phía sau vẫn một dòng: chỉ có MỘT vùng chi tiết và nó nằm trong hộp thoại
    expect(screen.getAllByRole('region', { name: /Chi tiết/ })).toHaveLength(1);
    expect(dialog.contains(screen.getByRole('region', { name: /Chi tiết/ }))).toBe(true);
  });

  it('Esc đóng và trả focus về nút Chi tiết', async () => {
    const user = setup();
    const btn = screen.getByRole('button', { name: 'Chi tiết TIRA-7' });
    await user.click(btn);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });
});
