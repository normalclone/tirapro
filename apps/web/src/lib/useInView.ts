import { useEffect, useState } from 'react';

interface ObserveOptions {
  rootMargin: string;
  once: boolean;
}

/** Quan sát `el` bằng IntersectionObserver; trả hàm dọn. Thuần (nhận constructor qua tham số) để test không cần DOM. */
export function observeInView(
  el: Element,
  { rootMargin, once }: ObserveOptions,
  onChange: (inView: boolean) => void,
  IO: typeof IntersectionObserver = IntersectionObserver,
): () => void {
  const io = new IO(
    (entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible) {
        onChange(true);
        if (once) io.disconnect();
      } else if (!once) {
        onChange(false);
      }
    },
    { rootMargin },
  );
  io.observe(el);
  return () => io.disconnect();
}

/**
 * Báo phần tử đã (sắp) vào khung nhìn chưa, bằng IntersectionObserver. Dùng để chỉ tải dữ liệu của khu nằm dưới
 * màn hình đầu tiên khi người dùng cuộn tới. Mặc định "một lần": đã vào khung nhìn rồi thì giữ `true`
 * (không tải lại / không gỡ khu đã mở). Trình duyệt không có IntersectionObserver thì coi như luôn nhìn thấy.
 * Observer được tạo/dọn trong effect nên an toàn với React.StrictMode (effect chạy hai lần ở dev); callback ref
 * chỉ đưa phần tử vào state.
 */
export function useInView<T extends Element = HTMLDivElement>({
  rootMargin = '200px',
  once = true,
}: { rootMargin?: string; once?: boolean } = {}) {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState(!supported);

  useEffect(() => {
    if (!el || !supported || (once && inView)) return;
    return observeInView(el, { rootMargin, once }, setInView);
  }, [el, supported, rootMargin, once, inView]);

  return { ref: setEl, inView };
}
