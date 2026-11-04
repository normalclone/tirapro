// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: vi.fn().mockRejectedValue(new Error('offline')), patch: h.patch } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { IssueDueField } from './IssueProperties';

const issue = (o: Partial<IssueDto> = {}) =>
  mk('d', { version: 5, dueDate: '2026-11-10T00:00:00.000Z', ...o });

function setup(i: IssueDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <IssueDueField issue={i} canEdit />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  h.patch.mockReset();
  h.patch.mockResolvedValue({ data: issue() });
});
afterEach(cleanup);

describe('Hạn trên trang việc: bắt buộc, không xoá được', () => {
  it('khi sửa: không có nút xoá/bỏ hạn nào (nếu có, chỉ là nút lịch)', async () => {
    const user = setup(issue());
    await user.click(screen.getByRole('button', { name: /10\/11\/2026/ }));
    await screen.findByLabelText('Hạn hoàn thành');
    const names = screen
      .queryAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names.some((n) => /xoá|xóa|bỏ|clear|gỡ/i.test(n ?? ''))).toBe(false);
  });

  it('xoá trống ô ngày rồi rời ô → KHÔNG gửi gì, hiện lại hạn cũ', async () => {
    const user = setup(issue());
    await user.click(screen.getByRole('button', { name: /10\/11\/2026/ }));
    const date = await screen.findByLabelText('Hạn hoàn thành');
    await user.clear(date);
    await user.tab();
    await user.tab();
    await waitFor(() => expect(screen.queryByLabelText('Hạn hoàn thành')).toBeNull());
    expect(h.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /10\/11\/2026/ })).toBeTruthy();
  });

  it('đổi sang ngày khác → PATCH đúng { dueDate: ngày lịch, version } (không bao giờ null)', async () => {
    const user = setup(issue());
    await user.click(screen.getByRole('button', { name: /10\/11\/2026/ }));
    const date = await screen.findByLabelText('Hạn hoàn thành');
    await user.clear(date);
    await user.type(date, '12/11/2026');
    await user.tab();
    await user.tab();
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch).toHaveBeenCalledWith('/issues/d', {
      dueDate: '2026-11-12T00:00:00.000Z',
      version: 5,
    });
  });
});
