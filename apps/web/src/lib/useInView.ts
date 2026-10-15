import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Báo phần tử đã (sắp) vào khung nhìn chưa, bằng IntersectionObserver. Dùng để chỉ tải dữ liệu của khu nằm dưới
 * màn hình đầu tiên khi người dùng cuộn tới. Mặc định "một lần": đã vào khung nhìn rồi thì giữ `true`
 * (không tải lại / không gỡ khu đã mở). Trình duyệt không có IntersectionObserver thì coi như luôn nhìn thấy.
 */
export function useInView<T extends Element = HTMLDivElement>({
  rootMargin = '200px',
  once = true,
}: { rootMargin?: string; once?: boolean } = {}) {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [inView, setInView] = useState(!supported);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || !supported) return;
      const io = new IntersectionObserver(
        (entries) => {
          const visible = entries.some((e) => e.isIntersecting);
          if (visible) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) {
            setInView(false);
          }
        },
        { rootMargin },
      );
      io.observe(el);
      observer.current = io;
    },
    [supported, rootMargin, once],
  );

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, inView };
}
