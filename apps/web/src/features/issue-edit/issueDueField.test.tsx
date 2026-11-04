// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { DueBadge } from '@/components/ui/DueBadge';
import { cellText } from '@/features/saved-filters/resultColumns';
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

describe('Hạn là ngày lịch: đúng ngày ở trình duyệt phía TÂY UTC (UTC-8)', () => {
  const realTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles'; // 00:00Z ngày 10/11 là 16:00 ngày 09/11 ở đây
  });
  afterAll(() => {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  });

  it('môi trường kiểm thử thật sự đang ở UTC-8 (nếu không, mấy test dưới vô nghĩa)', () => {
    expect(new Date('2026-11-10T00:00:00.000Z').getDate()).toBe(9);
  });

  it('hàng Hạn hiện 10/11/2026 (không lùi 09/11, không kèm giờ) và ô sửa cũng là 10/11/2026', async () => {
    const user = setup(issue());
    const btn = screen.getByRole('button', { name: /10\/11\/2026/ });
    expect(btn.textContent).toBe('10/11/2026');
    await user.click(btn);
    const date = await screen.findByLabelText<HTMLInputElement>('Hạn hoàn thành');
    expect(date.value).toBe('10/11/2026');
    await user.tab();
    await user.tab();
    expect(h.patch).not.toHaveBeenCalled(); // giá trị không đổi → không gửi
  });

  it('đổi sang 12/11 vẫn gửi đúng ngày lịch 2026-11-12 (không lệch theo múi giờ)', async () => {
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

  it('huy hiệu hạn, cột "Hạn" của kết quả lọc cùng ra 10/11', () => {
    const i = issue();
    expect(cellText(i, 'due', { projectKeyById: new Map() })).toBe('10/11/2026');
    render(<DueBadge issue={i} />);
    expect(screen.getByTitle(/10\/11/)).toBeTruthy();
  });
});
