import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fadeMask, revealScrollLeft, scrollFadeState } from './scrollFade';

/**
 * Hàng cuộn ngang trên màn hẹp: trả `ref` + `style` (biến CSS `--scroll-fade`, dùng với
 * `max-sm:[mask-image:var(--scroll-fade)]`) để mờ mép còn nội dung. `revealKey` + `revealSelector`: mỗi khi
 * `revealKey` đổi, cuộn ngang (chỉ trong khung này, không động tới cuộn trang) để phần tử khớp selector vào khung nhìn.
 * Khung cuộn phải là `position: relative` (offsetLeft của mục tính theo khung).
 */
export function useScrollFade<T extends HTMLElement>(revealKey?: string, revealSelector?: string) {
  const ref = useRef<T>(null);
  const [mask, setMask] = useState('none');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMask(fadeMask(scrollFadeState(el)));
    update();
    el.addEventListener('scroll', update, { passive: true });
    // Quan sát cả khung lẫn từng phần tử con: nội dung đổi kích thước (vd nút "Thêm" hiện nhãn) hoặc thêm/bớt mục thì cập nhật mặt nạ.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const watch = () => {
      ro?.disconnect();
      ro?.observe(el);
      for (const child of Array.from(el.children)) ro?.observe(child);
    };
    watch();
    const mo =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            watch();
            update();
          });
    mo?.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !revealSelector) return;
    const item = el.querySelector<HTMLElement>(revealSelector);
    if (!item) return;
    const next = revealScrollLeft(el, item);
    if (next !== null) el.scrollLeft = next;
  }, [revealKey, revealSelector]);

  return { ref, style: { '--scroll-fade': mask } as CSSProperties };
}
