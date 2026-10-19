import type { KeyboardEvent, MouseEvent } from 'react';
import { cn } from '@/lib/utils';

const noop = () => undefined;

/**
 * Ô chọn trên thẻ: hiện khi rê/focus thẻ (`group/row`), luôn hiện khi đang có lựa chọn và trên cảm ứng (vùng bấm 44px bằng
 * `::after`). Click có Shift = chọn dải. KHÔNG để cử chỉ lan sang thẻ — bấm không mở xem nhanh, không bắt đầu kéo (dnd-kit
 * nghe pointerdown/mousedown/touchstart/keydown trên gốc thẻ) — giống nút "…".
 */
export function SelectCheckbox({
  issueKey,
  checked,
  alwaysVisible,
  onToggle,
  onRange,
}: {
  issueKey: string;
  checked: boolean;
  /** Đang có lựa chọn ở đâu đó trên bảng → mọi ô đều hiện. */
  alwaysVisible: boolean;
  onToggle: () => void;
  onRange: () => void;
}) {
  function onClick(e: MouseEvent) {
    e.stopPropagation();
    if (e.shiftKey) onRange();
    else onToggle();
  }
  function onKeyDown(e: KeyboardEvent) {
    // Esc phải tới `document` (bỏ chọn); phím khác không được tới thẻ (Space nhấc thẻ, mũi tên dời thẻ, Enter mở).
    if (e.key !== 'Escape') e.stopPropagation();
  }
  return (
    <span
      data-no-peek
      data-select-box
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        'absolute -left-1.5 -top-1.5 z-10 grid h-5 w-5 place-items-center rounded border border-border bg-surface shadow-sm',
        'transition-opacity motion-reduce:transition-none',
        checked && 'border-primary',
        alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 focus-within:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        '[@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-[13px] [@media(pointer:coarse)]:after:content-[""]',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={noop}
        onKeyDown={onKeyDown}
        aria-label={`Chọn ${issueKey}`}
        className="h-3.5 w-3.5 cursor-pointer accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      />
    </span>
  );
}
