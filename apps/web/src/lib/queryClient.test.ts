import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const described = new WeakSet<object>();
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./api', () => ({
  apiErrorMessage: (e: unknown) => {
    if (typeof e === 'object' && e) described.add(e);
    return (e as Error).message;
  },
  wasErrorDescribed: (e: unknown) => typeof e === 'object' && e !== null && described.has(e),
}));
import { toast } from 'sonner';
import { apiErrorMessage } from './api';
import { mutationCache, queryClient } from './queryClient';

const build = (err: Error, opts: Record<string, unknown> = {}) =>
  mutationCache.build(queryClient, { mutationFn: () => Promise.reject(err), ...opts });

describe('toast lỗi mutation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toast.error).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('không ai tự báo → đúng một toast, id theo nội dung', async () => {
    await build(new Error('Lỗi A'))
      .execute(undefined)
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Lỗi A', { id: 'mutation-error:Lỗi A' });
  });

  it('catch quanh mutateAsync tự báo bằng apiErrorMessage → bỏ qua toast chung', async () => {
    const err = new Error('Lỗi B');
    try {
      await build(err).execute(undefined);
    } catch (e) {
      apiErrorMessage(e);
    }
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('onError cấp hook bất đồng bộ thật (chờ 50ms) rồi mới apiErrorMessage → KHÔNG toast đôi', async () => {
    const err = new Error('Lỗi C');
    const p = build(err, {
      onError: async () => {
        await new Promise((r) => setTimeout(r, 50));
        apiErrorMessage(err);
      },
    })
      .execute(undefined)
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    await p;
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('meta.silent → không toast', async () => {
    await build(new Error('Lỗi D'), { meta: { silent: true } })
      .execute(undefined)
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('hai lỗi giống hệt → cùng id (sonner gộp thành một toast)', async () => {
    await Promise.all(
      [build(new Error('Lỗi E')), build(new Error('Lỗi E'))].map((m) =>
        m.execute(undefined).catch(() => undefined),
      ),
    );
    await vi.advanceTimersByTimeAsync(5);
    const ids = vi.mocked(toast.error).mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(ids).toEqual(['mutation-error:Lỗi E', 'mutation-error:Lỗi E']);
  });

  it('onError cấp hook đồng bộ tự toast qua apiErrorMessage → đúng một toast (của hook)', async () => {
    const err = new Error('Lỗi F');
    await build(err, { onError: () => void toast.error(apiErrorMessage(err)) })
      .execute(undefined)
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('hai lỗi khác nội dung → hai toast với id khác nhau', async () => {
    await Promise.all(
      [build(new Error('Lỗi G')), build(new Error('Lỗi H'))].map((m) =>
        m.execute(undefined).catch(() => undefined),
      ),
    );
    await vi.advanceTimersByTimeAsync(5);
    const ids = vi.mocked(toast.error).mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(ids).toEqual(['mutation-error:Lỗi G', 'mutation-error:Lỗi H']);
  });
});
