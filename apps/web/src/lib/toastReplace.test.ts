import { beforeEach, describe, expect, it, vi } from 'vitest';

const success = vi.fn<(...a: unknown[]) => void>();
const error = vi.fn<(...a: unknown[]) => void>();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => error(...a) },
}));

import { toastReplace } from './toastReplace';

beforeEach(() => {
  success.mockReset();
  error.mockReset();
});

describe('toastReplace — thay hẳn toast cùng id (sonner gộp {...cũ, ...mới})', () => {
  it('luôn ghi đè action/description/onDismiss/onAutoClose bằng undefined khi không truyền', () => {
    toastReplace('t1', 'error', 'Lỗi');
    expect(error).toHaveBeenCalledTimes(1);
    const [msg, data] = error.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toBe('Lỗi');
    expect(data.id).toBe('t1');
    for (const k of ['action', 'description', 'onDismiss', 'onAutoClose']) {
      expect(k in data).toBe(true); // khoá PHẢI có mặt (spread của khoá undefined mới ghi đè được)
      expect(data[k]).toBeUndefined();
    }
  });
  it('success dùng toast.success; opts được truyền thì giữ', () => {
    const onDismiss = vi.fn();
    const action = { label: 'Hoàn tác', onClick: vi.fn() };
    toastReplace('t2', 'success', 'Xong', {
      description: 'mô tả',
      duration: 6000,
      action,
      onDismiss,
    });
    const [, data] = success.mock.calls[0] as [string, Record<string, unknown>];
    expect(error).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      id: 't2',
      description: 'mô tả',
      duration: 6000,
      action,
      onDismiss,
    });
    expect(data.onAutoClose).toBeUndefined();
    expect('onAutoClose' in data).toBe(true);
  });
});
