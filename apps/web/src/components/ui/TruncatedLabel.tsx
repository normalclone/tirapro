import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Nhãn menu tự cắt bớt bằng dấu "…" khi hẹp, và CHỈ gắn tooltip khi chữ thật sự
 * bị cắt.
 *
 * Vì sao: tooltip giải nghĩa gắn cứng vào từng mục menu gây nhiễu — người dùng
 * đã thuộc menu vẫn bị popup che mỗi lần rê chuột qua. Ở menu, tooltip chỉ nên
 * đóng vai trò cứu cánh: đọc nốt phần chữ không hiển thị hết.
 *
 * Kiểm tra lại mỗi khi phần tử đổi kích thước (thu hẹp cửa sổ, mở/đóng thanh
 * bên) và sau khi font tải xong — đo trước lúc font Geist swap sẽ ra sai.
 */
export function TruncatedLabel({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // +1px bù sai số làm tròn của layout ở một số mức phóng to.
    if (el.scrollWidth > el.clientWidth + 1) {
      el.setAttribute('title', text);
    } else {
      el.removeAttribute('title');
      // InstantTooltip chuyển title → data-tip ở lần rê chuột đầu, phải dọn cả nó.
      el.removeAttribute('data-tip');
    }
  }, [text]);

  useEffect(() => {
    sync();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    void document.fonts?.ready.then(sync);
    return () => ro.disconnect();
  }, [sync]);

  return (
    <span ref={ref} className={cn('min-w-0 truncate', className)}>
      {text}
    </span>
  );
}
