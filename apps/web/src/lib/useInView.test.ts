import { beforeEach, describe, expect, it, vi } from 'vitest';
import { observeInView } from './useInView';

class FakeIO {
  static instances: FakeIO[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(
    private readonly cb: IntersectionObserverCallback,
    readonly opts?: IntersectionObserverInit,
  ) {
    FakeIO.instances.push(this);
  }
  observe(el: unknown) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean) {
    this.cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}
const IO = FakeIO as unknown as typeof IntersectionObserver;
const el = {} as Element;

describe('observeInView', () => {
  beforeEach(() => {
    FakeIO.instances = [];
  });

  it('quan sát phần tử với rootMargin; vào khung nhìn => báo true và (once) tự ngắt', () => {
    const cb = vi.fn();
    observeInView(el, { rootMargin: '200px', once: true }, cb, IO);
    const io = FakeIO.instances[0]!;
    expect(io.observed).toEqual([el]);
    expect(io.opts).toEqual({ rootMargin: '200px' });
    io.fire(false);
    expect(cb).not.toHaveBeenCalled();
    io.fire(true);
    expect(cb).toHaveBeenCalledWith(true);
    expect(io.disconnected).toBe(true);
  });

  it('once=false: báo cả khi rời khung nhìn và không tự ngắt', () => {
    const cb = vi.fn();
    observeInView(el, { rootMargin: '0px', once: false }, cb, IO);
    const io = FakeIO.instances[0]!;
    io.fire(true);
    io.fire(false);
    expect(cb.mock.calls).toEqual([[true], [false]]);
    expect(io.disconnected).toBe(false);
  });

  it('StrictMode (effect chạy rồi dọn rồi chạy lại): observer thứ hai hoạt động, observer đầu đã ngắt — KHÔNG bị "chết vĩnh viễn"', () => {
    const cb = vi.fn();
    const start = () => observeInView(el, { rootMargin: '200px', once: true }, cb, IO);
    const cleanup1 = start();
    cleanup1(); // StrictMode mô phỏng unmount
    start(); // mount lại
    const [first, second] = FakeIO.instances;
    expect(first!.disconnected).toBe(true);
    expect(second!.disconnected).toBe(false);
    second!.fire(true);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('hàm dọn ngắt observer', () => {
    const stop = observeInView(el, { rootMargin: '0px', once: true }, vi.fn(), IO);
    stop();
    expect(FakeIO.instances[0]!.disconnected).toBe(true);
  });
});
