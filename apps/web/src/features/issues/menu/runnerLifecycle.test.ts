import { describe, expect, it } from 'vitest';
import { runnerLifecycle, SAFETY_MS, UNDO_WINDOW_MS } from './runnerLifecycle';

const base = {
  dialogOpen: false,
  isPending: false,
  succeeded: false,
  failed: false,
  dialogSeen: false,
};

describe('runnerLifecycle — khi nào gỡ runner đổi trạng thái', () => {
  it('hộp đang mở: giữ, dù đã quá chốt chặn (không có hẹn giờ nào chạy)', () => {
    expect(runnerLifecycle({ ...base, dialogOpen: true, dialogSeen: true })).toBe('keep');
    expect(SAFETY_MS).toBeGreaterThanOrEqual(60_000);
  });
  it('xác nhận thất bại (409/500): hộp vẫn mở → giữ hộp cùng chữ đã gõ, không hẹn cửa sổ Hoàn tác', () => {
    expect(runnerLifecycle({ ...base, dialogOpen: true, dialogSeen: true, failed: true })).toBe(
      'keep',
    );
  });
  it('đang chạy mutation (kể cả thử lại sau lỗi): giữ, huỷ mọi hẹn giờ cũ', () => {
    expect(runnerLifecycle({ ...base, isPending: true, dialogSeen: true, dialogOpen: true })).toBe(
      'keep',
    );
    expect(runnerLifecycle({ ...base, isPending: true, failed: true })).toBe('keep');
  });
  it('thành công và hộp đã đóng: giữ cho cửa sổ Hoàn tác rồi gỡ', () => {
    expect(runnerLifecycle({ ...base, succeeded: true, dialogSeen: true })).toEqual({
      removeAfterMs: UNDO_WINDOW_MS,
    });
    expect(runnerLifecycle({ ...base, succeeded: true })).toEqual({
      removeAfterMs: UNDO_WINDOW_MS,
    });
  });
  it('thành công nhưng hộp còn mở (chưa kịp đóng): chưa hẹn gì', () => {
    expect(runnerLifecycle({ ...base, succeeded: true, dialogOpen: true, dialogSeen: true })).toBe(
      'keep',
    );
  });
  it('huỷ hộp (chưa chuyển gì): gỡ ngay', () => {
    expect(runnerLifecycle({ ...base, dialogSeen: true })).toEqual({ removeAfterMs: 0 });
  });
  it('huỷ hộp sau một lần xác nhận lỗi: gỡ ngay', () => {
    expect(runnerLifecycle({ ...base, dialogSeen: true, failed: true })).toEqual({
      removeAfterMs: 0,
    });
  });
  it('lỗi khi chuyển thẳng (không hộp): gỡ ngay, không có gì để Hoàn tác', () => {
    expect(runnerLifecycle({ ...base, failed: true })).toEqual({ removeAfterMs: 0 });
  });
  it('mới dựng, chưa có gì xảy ra (đang chờ meta dự án…): chốt chặn', () => {
    expect(runnerLifecycle(base)).toEqual({ removeAfterMs: SAFETY_MS });
  });
});
