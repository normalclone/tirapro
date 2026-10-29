import { describe, expect, it } from 'vitest';
import {
  createCancellable,
  initialRequestState,
  initialScopedState,
  requestReducer,
  scopedReducer,
  scopedView,
} from './cancellableRequest';

const defer = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createCancellable', () => {
  it('chạy bình thường → done kèm giá trị; truyền AbortSignal chưa huỷ cho hàm gửi', async () => {
    let seen: AbortSignal | undefined;
    const c = createCancellable((signal) => {
      seen = signal;
      return Promise.resolve(42);
    });
    await expect(c.start()).resolves.toEqual({ kind: 'done', value: 42 });
    expect(seen?.aborted).toBe(false);
    expect(c.active()).toBe(false);
  });

  it('huỷ giữa chừng: tín hiệu abort được bắn, kết quả là cancelled (KHÔNG phải failed → không toast lỗi)', async () => {
    const d = defer<number>();
    let seen!: AbortSignal;
    const c = createCancellable((signal) => {
      seen = signal;
      signal.addEventListener('abort', () => d.reject(new DOMException('aborted', 'AbortError')));
      return d.promise;
    });
    const p = c.start();
    expect(c.active()).toBe(true);
    c.cancel();
    expect(seen.aborted).toBe(true);
    await expect(p).resolves.toEqual({ kind: 'cancelled' });
    expect(c.active()).toBe(false);
  });

  it('phản hồi ĐẾN MUỘN sau khi huỷ bị bỏ qua (kể cả khi máy chủ vẫn trả thành công)', async () => {
    const d = defer<string>();
    const c = createCancellable(() => d.promise); // không lắng nghe abort: mô phỏng phản hồi đã bay
    const p = c.start();
    c.cancel();
    d.resolve('kết quả muộn');
    await expect(p).resolves.toEqual({ kind: 'cancelled' });
  });

  it('lỗi thật (không huỷ) → failed kèm lỗi; lỗi đến muộn sau khi huỷ vẫn là cancelled', async () => {
    const boom = new Error('500');
    await expect(createCancellable(() => Promise.reject(boom)).start()).resolves.toEqual({
      kind: 'failed',
      error: boom,
    });
    const d = defer<number>();
    const c = createCancellable(() => d.promise);
    const p = c.start();
    c.cancel();
    d.reject(boom);
    await expect(p).resolves.toEqual({ kind: 'cancelled' });
  });

  it('bắt đầu lần mới khi lần cũ còn chạy: lần cũ bị huỷ và bỏ kết quả, lần mới giữ nguyên', async () => {
    const first = defer<string>();
    const second = defer<string>();
    let n = 0;
    const c = createCancellable(() => (n++ === 0 ? first.promise : second.promise));
    const p1 = c.start();
    const p2 = c.start();
    first.resolve('cũ');
    second.resolve('mới');
    await expect(p1).resolves.toEqual({ kind: 'cancelled' });
    await expect(p2).resolves.toEqual({ kind: 'done', value: 'mới' });
  });

  it('huỷ khi không có gì chạy: không lỗi', () => {
    const c = createCancellable(() => Promise.resolve(1));
    expect(() => c.cancel()).not.toThrow();
  });
});

describe('requestReducer', () => {
  it('idle → pending → done giữ dữ liệu; bắt đầu lại xoá kết quả cũ', () => {
    let s = requestReducer(initialRequestState<number>(), { type: 'start' });
    expect(s).toEqual({ phase: 'pending' });
    s = requestReducer(s, { type: 'done', value: 7 });
    expect(s).toEqual({ phase: 'done', data: 7 });
    expect(requestReducer(s, { type: 'start' })).toEqual({ phase: 'pending' });
  });
  it('huỷ về idle KHÔNG giữ lỗi và không hiện kết quả', () => {
    const s = requestReducer({ phase: 'pending' }, { type: 'cancel' });
    expect(s).toEqual({ phase: 'idle' });
  });
  it('failed giữ lỗi; sự kiện done/failed đến khi không còn pending (đã huỷ) bị bỏ qua', () => {
    expect(requestReducer({ phase: 'pending' }, { type: 'failed', error: 'x' })).toEqual({
      phase: 'failed',
      error: 'x',
    });
    expect(requestReducer({ phase: 'idle' }, { type: 'done', value: 1 })).toEqual({
      phase: 'idle',
    });
    expect(requestReducer({ phase: 'idle' }, { type: 'failed', error: 'x' })).toEqual({
      phase: 'idle',
    });
  });
});

describe('scopedReducer / scopedView — kết quả thuộc về MỘT issue (I1)', () => {
  it('đang chờ ở issue A, sang issue B: B thấy idle (không "Đang phân tích…" mãi mãi)', () => {
    const s = scopedReducer<number>(initialScopedState<number>(), { type: 'start', forId: 'A' });
    expect(scopedView(s, 'A')).toEqual({ phase: 'pending' });
    expect(scopedView(s, 'B')).toEqual({ phase: 'idle' });
  });
  it('đã có kết quả ở A, sang B: B KHÔNG thấy kết quả/nguồn của A', () => {
    let s = scopedReducer<number>(initialScopedState<number>(), { type: 'start', forId: 'A' });
    s = scopedReducer(s, { type: 'done', forId: 'A', value: 5 });
    expect(scopedView(s, 'A')).toEqual({ phase: 'done', data: 5 });
    expect(scopedView(s, 'B')).toEqual({ phase: 'idle' });
  });
  it('kết quả/lỗi của A đến muộn sau khi B đã bắt đầu bị bỏ qua', () => {
    let s = scopedReducer<number>(initialScopedState<number>(), { type: 'start', forId: 'A' });
    s = scopedReducer(s, { type: 'start', forId: 'B' });
    s = scopedReducer(s, { type: 'done', forId: 'A', value: 1 });
    expect(scopedView(s, 'B')).toEqual({ phase: 'pending' });
    s = scopedReducer(s, { type: 'failed', forId: 'A', error: 'x' });
    expect(scopedView(s, 'B')).toEqual({ phase: 'pending' });
    s = scopedReducer(s, { type: 'done', forId: 'B', value: 2 });
    expect(scopedView(s, 'B')).toEqual({ phase: 'done', data: 2 });
  });
  it('huỷ chỉ áp cho issue đang xem; huỷ của issue khác bị bỏ qua', () => {
    let s = scopedReducer<number>(initialScopedState<number>(), { type: 'start', forId: 'B' });
    s = scopedReducer(s, { type: 'cancel', forId: 'A' });
    expect(scopedView(s, 'B')).toEqual({ phase: 'pending' });
    s = scopedReducer(s, { type: 'cancel', forId: 'B' });
    expect(scopedView(s, 'B')).toEqual({ phase: 'idle' });
  });
  it('quay lại A sau khi đã sang B không "sống lại" kết quả cũ của A', () => {
    let s = scopedReducer<number>(initialScopedState<number>(), { type: 'start', forId: 'A' });
    s = scopedReducer(s, { type: 'done', forId: 'A', value: 5 });
    s = scopedReducer(s, { type: 'start', forId: 'B' });
    expect(scopedView(s, 'A')).toEqual({ phase: 'idle' });
  });
});
