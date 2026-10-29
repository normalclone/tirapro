import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirm, useConfirmStore } from './useConfirm';

describe('useConfirm — mở hộp sau sự kiện hiện tại', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConfirmStore.setState({ open: false, opts: null, resolve: null });
  });
  afterEach(() => vi.useRealTimers());

  it('KHÔNG mở ngay trong cùng tick (keypress của Enter còn đang đi) — mở ở macrotask kế', () => {
    void useConfirm()({ title: 'A' });
    expect(useConfirmStore.getState().open).toBe(false);
    vi.runAllTimers();
    expect(useConfirmStore.getState()).toMatchObject({ open: true, opts: { title: 'A' } });
  });

  it('gọi lần nữa khi hộp trước còn chờ mở: huỷ hộp trước (false), chỉ hộp sau mở', async () => {
    const ask = useConfirm();
    const first = ask({ title: 'A' });
    const second = ask({ title: 'B' });
    await expect(first).resolves.toBe(false);
    vi.runAllTimers();
    expect(useConfirmStore.getState().opts?.title).toBe('B');
    useConfirmStore.getState().resolve?.(true);
    await expect(second).resolves.toBe(true);
  });

  it('gọi lần nữa khi hộp trước đang hiện: hộp trước coi như bỏ qua (false)', async () => {
    const ask = useConfirm();
    const first = ask({ title: 'A' });
    vi.runAllTimers();
    void ask({ title: 'B' });
    await expect(first).resolves.toBe(false);
  });

  it('requireText đi cùng opts tới host (mỗi lần mở là một opts mới → ô nhập được reset)', () => {
    const ask = useConfirm();
    void ask({ title: 'A', requireText: 'CI deploy' });
    vi.runAllTimers();
    const first = useConfirmStore.getState().opts;
    expect(first?.requireText).toBe('CI deploy');
    void ask({ title: 'A', requireText: 'CI deploy' });
    vi.runAllTimers();
    expect(useConfirmStore.getState().opts).not.toBe(first);
  });
});
