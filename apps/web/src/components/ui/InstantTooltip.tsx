import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip TOÀN CỤC hiện TỨC THÌ khi rê chuột (hoặc focus bàn phím) vào phần tử có
 * thuộc tính `title`.
 *
 * Vì sao làm kiểu này: app có ~237 chỗ dùng `title=""`. Tooltip mặc định của trình
 * duyệt trễ 1–2 giây và không style được. Thay vì sửa từng chỗ, ta bắt sự kiện ở
 * cấp document rồi CHUYỂN `title` → `data-tip` (một lần, idempotent) để chặn tooltip
 * gốc, và tự vẽ tooltip theo design token.
 *
 * - Hiện ngay (không delay), ẩn khi rời chuột/cuộn/bấm/Escape.
 * - Có hỗ trợ bàn phím: focus vào cũng hiện (a11y).
 * - Tự lật vị trí khi chạm mép màn hình.
 * - Bỏ qua ô nhập liệu và phần tử có `data-no-tip`.
 */
const OFFSET = 8;

interface TipState {
  text: string;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
}

/**
 * Lấy text tooltip. `title` LUÔN được ưu tiên vì nó là bản mới nhất: khi React
 * render lại với nội dung tooltip khác, nó ghi lại thuộc tính `title` trên DOM —
 * nếu đọc `data-tip` trước thì tooltip động (đếm số, đổi trạng thái) sẽ đứng im ở
 * chữ của lần rê chuột đầu tiên.
 */
function readTip(el: HTMLElement): string {
  const title = el.getAttribute('title');
  if (title !== null) {
    // Chuyển hẳn sang data-tip để trình duyệt không hiện tooltip gốc (trễ + xấu).
    el.setAttribute('data-tip', title);
    el.removeAttribute('title');
    return title;
  }
  return el.getAttribute('data-tip') ?? '';
}

export function InstantTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function show(el: HTMLElement) {
      if (el.hasAttribute('data-no-tip')) return;
      const text = readTip(el).trim();
      if (!text) return;
      targetRef.current = el;
      const r = el.getBoundingClientRect();
      // Mặc định đặt phía trên; nếu không đủ chỗ thì xuống dưới.
      const placement: TipState['placement'] = r.top < 64 ? 'bottom' : 'top';
      setTip({
        text,
        x: r.left + r.width / 2,
        y: placement === 'top' ? r.top - OFFSET : r.bottom + OFFSET,
        placement,
      });
    }

    function hide() {
      targetRef.current = null;
      setTip(null);
    }

    function onOver(e: Event) {
      const t = e.target as HTMLElement | null;
      const el = t?.closest?.('[title],[data-tip]') as HTMLElement | null;
      if (!el) {
        if (targetRef.current) hide();
        return;
      }
      if (el === targetRef.current) return;
      show(el);
    }

    function onOut(e: MouseEvent) {
      const to = e.relatedTarget as HTMLElement | null;
      if (targetRef.current && to && targetRef.current.contains(to)) return;
      hide();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') hide();
    }

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onOver, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('click', hide, true);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onOver, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      document.removeEventListener('click', hide, true);
    };
  }, []);

  if (!tip) return null;

  // Giữ tooltip trong khung nhìn theo trục ngang.
  const half = (tipRef.current?.offsetWidth ?? 160) / 2;
  const x = Math.min(Math.max(tip.x, half + 8), window.innerWidth - half - 8);

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      style={{
        position: 'fixed',
        left: x,
        top: tip.y,
        transform: `translate(-50%, ${tip.placement === 'top' ? '-100%' : '0'})`,
        zIndex: 1500,
        pointerEvents: 'none',
        maxWidth: 'min(22rem, calc(100vw - 2rem))',
        whiteSpace: 'pre-line',
      }}
      className="rounded-md border border-border bg-[var(--ink-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--bg)] shadow-lg"
    >
      {tip.text}
    </div>,
    document.body,
  );
}
