import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip TOÀN CỤC hiện TỨC THÌ khi rê chuột (hoặc focus bàn phím) vào phần tử có
 * thuộc tính `title`.
 *
 * Vì sao làm kiểu này: app có ~237 chỗ dùng `title=""`. Tooltip mặc định của trình
 * duyệt trễ 1–2 giây và không style được. Thay vì sửa từng chỗ, ta bắt sự kiện ở
 * cấp document rồi TẠM cất `title` sang `data-tip` trong lúc tooltip của ta đang hiện (để chặn
 * tooltip gốc), hết hiện thì TRẢ LẠI `title` — nhờ vậy tên truy cập (accessible name) của nút chỉ có
 * `title` không bao giờ biến mất khỏi DOM. Trong lúc hiện, phần tử trỏ `aria-describedby` tới tooltip.
 *
 * - Hiện ngay (không delay), ẩn khi rời chuột/cuộn/bấm/Escape.
 * - Có hỗ trợ bàn phím: focus vào cũng hiện (a11y).
 * - Tự lật vị trí khi chạm mép màn hình.
 * - Bỏ qua ô nhập liệu và phần tử có `data-no-tip`.
 */
const OFFSET = 8;
const TIP_ID = 'instant-tooltip';

/** Phần tử đang được cất `title` để chặn tooltip gốc; `hide()` trả lại. */
interface Stash { el: HTMLElement; title: string | null; describedBy: string | null }

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
function readTip(el: HTMLElement): { text: string; title: string | null } {
  const title = el.getAttribute('title');
  if (title !== null) return { text: title, title };
  return { text: el.getAttribute('data-tip') ?? '', title: null };
}

/** Bỏ token `TIP_ID` khỏi `aria-describedby` (giữ nguyên các id khác nếu có). */
function dropDescribedBy(el: HTMLElement) {
  const rest = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && t !== TIP_ID);
  if (rest.length) el.setAttribute('aria-describedby', rest.join(' '));
  else el.removeAttribute('aria-describedby');
}

export function InstantTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let stash: Stash | null = null;

    /** Trả lại `title`/`aria-describedby` của phần tử vừa hiện tooltip. */
    function restore() {
      if (!stash) return;
      const { el, title } = stash;
      dropDescribedBy(el);
      // React có thể đã ghi `title` mới trong lúc đang hiện → chỉ trả lại nếu chưa có.
      if (title !== null && !el.hasAttribute('title')) el.setAttribute('title', title);
      if (title !== null) el.removeAttribute('data-tip'); // chỉ dọn data-tip do chính ta tạo
      stash = null;
    }

    function show(el: HTMLElement) {
      if (el.hasAttribute('data-no-tip')) return;
      const { text: raw, title } = readTip(el);
      const text = raw.trim();
      if (!text) return;
      restore();
      if (title !== null) {
        // Cất tạm để trình duyệt không hiện tooltip gốc (trễ + xấu); `hide()` sẽ trả lại.
        el.setAttribute('data-tip', title);
        el.removeAttribute('title');
      }
      const prev = el.getAttribute('aria-describedby');
      el.setAttribute('aria-describedby', prev ? `${prev} ${TIP_ID}` : TIP_ID);
      stash = { el, title, describedBy: prev };
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

    /** Ẩn tooltip nhưng GIỮ `title` đang cất tới khi chuột/focus rời phần tử — tránh tooltip gốc bật lên ngay sau khi bấm/cuộn. */
    function softHide() {
      targetRef.current = null;
      setTip(null);
    }

    function hide() {
      restore();
      softHide();
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
      if (e.key === 'Escape') softHide();
    }

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onOver, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', softHide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('click', softHide, true);
    return () => {
      restore();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onOver, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', softHide, true);
      window.removeEventListener('blur', hide);
      document.removeEventListener('click', softHide, true);
    };
  }, []);

  if (!tip) return null;

  // Giữ tooltip trong khung nhìn theo trục ngang.
  const half = (tipRef.current?.offsetWidth ?? 160) / 2;
  const x = Math.min(Math.max(tip.x, half + 8), window.innerWidth - half - 8);

  return createPortal(
    <div
      ref={tipRef}
      id={TIP_ID}
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
