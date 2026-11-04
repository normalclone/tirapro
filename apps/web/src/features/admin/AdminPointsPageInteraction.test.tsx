// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POINTS_FORMULA } from '@tirapro/shared';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { get: h.get, put: h.put } };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { AdminPointsPage, POINTS_SAVED_TOAST } from './AdminPointsPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminPointsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu bảng hệ số' });

beforeEach(() => {
  h.get.mockReset();
  h.put.mockReset();
  h.get.mockResolvedValue({ data: DEFAULT_POINTS_FORMULA });
  h.put.mockImplementation((_u: string, body: unknown) => Promise.resolve({ data: body }));
});
afterEach(cleanup);

describe('trang Cách tính điểm (tương tác thật)', () => {
  it('nạp bảng từ GET /admin/points-formula; chưa sửa thì Lưu bị khoá', async () => {
    renderPage();
    const bug = await screen.findByLabelText('Điểm gốc theo loại: Bug');
    expect((bug as HTMLInputElement).value).toBe('2');
    expect(h.get).toHaveBeenCalledWith('/admin/points-formula');
    expect(save().disabled).toBe(true);
  });

  it('ô sai (0, rỗng, > 100) → báo lỗi ngay ô đó và khoá Lưu; sửa lại hợp lệ → mở Lưu', async () => {
    const user = renderPage();
    const cell = await screen.findByLabelText<HTMLInputElement>('Hệ số độ khó: Khó');
    await user.clear(cell);
    await user.type(cell, '0');
    expect(screen.getByText('Phải lớn hơn 0')).toBeTruthy();
    expect(cell.getAttribute('aria-invalid')).toBe('true');
    expect(save().disabled).toBe(true);

    await user.clear(cell);
    expect(screen.getByText('Nhập hệ số')).toBeTruthy();
    expect(save().disabled).toBe(true);

    await user.type(cell, '101');
    expect(screen.getByText('Tối đa 100')).toBeTruthy();
    expect(save().disabled).toBe(true);

    await user.clear(cell);
    await user.type(cell, '4');
    expect(screen.queryByText('Tối đa 100')).toBeNull();
    expect(save().disabled).toBe(false);
    expect(h.put).not.toHaveBeenCalled();
  });

  it('sửa hợp lệ + Lưu → PUT /admin/points-formula với cả bảng (số, không phải chuỗi) và toast tính lại', async () => {
    const user = renderPage();
    const bug = await screen.findByLabelText<HTMLInputElement>('Điểm gốc theo loại: Bug');
    const high = screen.getByLabelText<HTMLInputElement>('Hệ số ưu tiên: High');
    await user.clear(bug);
    await user.type(bug, '3');
    await user.clear(high);
    await user.type(high, '1,75'); // dấu phẩy thập phân
    await user.click(save());

    await waitFor(() => expect(h.put).toHaveBeenCalledTimes(1));
    expect(h.put).toHaveBeenCalledWith('/admin/points-formula', {
      base: { ...DEFAULT_POINTS_FORMULA.base, BUG: 3 },
      difficulty: DEFAULT_POINTS_FORMULA.difficulty,
      priority: { ...DEFAULT_POINTS_FORMULA.priority, High: 1.75 },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(POINTS_SAVED_TOAST));
  });

  it('ví dụ sống đổi theo bảng đang gõ (chưa lưu)', async () => {
    const user = renderPage();
    const bug = await screen.findByLabelText('Điểm gốc theo loại: Bug');
    expect(screen.getByText('Bug · Khó · High = 2×3×1.5 = 9')).toBeTruthy();
    await user.clear(bug);
    await user.type(bug, '4');
    expect(screen.getByText('Bug · Khó · High = 4×3×1.5 = 18')).toBeTruthy();
  });

  it('Khôi phục mặc định đưa bảng về mặc định và mở Lưu khi bảng đang khác', async () => {
    const user = renderPage();
    const bug = await screen.findByLabelText<HTMLInputElement>('Điểm gốc theo loại: Bug');
    await user.clear(bug);
    await user.type(bug, '9');
    await user.click(screen.getByRole('button', { name: 'Khôi phục mặc định' }));
    expect(bug.value).toBe('2');
    expect(save().disabled).toBe(true); // bằng bảng đã lưu → không có gì để lưu
  });
});
