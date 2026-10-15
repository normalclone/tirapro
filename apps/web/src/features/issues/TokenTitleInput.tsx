import { useRef, useState, type Ref } from 'react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import {
  activeTokenAt,
  shouldAcceptSuggestionOnKey,
  suggestFor,
  tokenSegments,
  unmatchedTokens,
  type TokenKind,
  type ActiveToken,
  type Suggestion,
  type TokenCtx,
} from './titleTokens';

const UNMATCHED_HINT: Record<TokenKind, string> = {
  priority: 'gõ ! để chọn mức ưu tiên từ danh sách',
  assignee: 'gõ @ để chọn người',
  sprint: 'gõ # để chọn sprint',
  points: 'điểm là một số, ví dụ ~5',
  due: 'hạn như mai, t6, 3d, 15/8',
};

/**
 * Ô tiêu đề "thông minh": gõ token (!ưu-tiên @người #sprint ~điểm ^hạn) →
 * gợi ý (dropdown cho !/@/#) + tô sáng token hợp lệ ngay trong ô. Trả text thô qua onChange.
 */
export function TokenTitleInput({
  value,
  onChange,
  ctx,
  onBlur,
  placeholder,
  id,
  autoFocus,
  bare,
  onEnter,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  ctx: TokenCtx;
  onBlur?: () => void;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  /** Không viền/nền riêng — để nhúng vào hàng quick-add. */
  bare?: boolean;
  /** Enter trơn (không có popup gợi ý) — dùng cho quick-add; hộp tạo việc không truyền. */
  onEnter?: () => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [idx, setIdx] = useState(0);
  const activeRef = useRef<(ActiveToken & { caretEnd: number }) | null>(null);
  // Đang gõ tiếng Việt qua IME → không quét token / không đụng caret giữa chừng composition.
  const composingRef = useRef(false);

  // Đã rời ô → token ở đuôi cũng được coi là gõ xong (cảnh báo cả token không khớp ở cuối).
  const [blurred, setBlurred] = useState(false);
  const segments = tokenSegments(value, ctx, { skipTail: !blurred });
  const warns = unmatchedTokens(value, ctx, { skipTail: !blurred });

  // Cuộn ngang backdrop khớp với input khi text tràn.
  function syncScroll() {
    const el = ref.current,
      bd = backdropRef.current;
    if (el && bd) bd.scrollLeft = el.scrollLeft;
  }

  function refresh() {
    syncScroll();
    if (composingRef.current) return; // giữa chừng IME → chưa quét
    const el = ref.current;
    if (!el) return;
    const v = el.value;
    const caret = el.selectionStart ?? v.length;
    const at = activeTokenAt(v, caret);
    if (at && (at.sym === '!' || at.sym === '@' || at.sym === '#')) {
      const list = suggestFor(at.sym, at.partial, ctx);
      activeRef.current = { ...at, caretEnd: caret };
      setItems(list);
      setIdx(0);
      setOpen(list.length > 0);
      return;
    }
    setOpen(false);
  }

  function accept(s: Suggestion) {
    const at = activeRef.current;
    if (!at) return;
    const before = value.slice(0, at.start);
    const after = value.slice(at.caretEnd);
    const insert = `${s.insert} `;
    const next = before + insert + after;
    onChange(next);
    setOpen(false);
    const pos = (before + insert).length;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  return (
    <div>
      <div className="relative">
        {/* Lớp tô sáng phía sau: vẽ lại text, token đã nhận được bọc nền màu. Căn khít với input. */}
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre rounded-md border border-transparent px-3 text-sm leading-[34px] text-ink',
            bare && 'px-0',
          )}
        >
          {segments.map((s, i) =>
            s.kind === 'unknown' ? (
              <span
                key={i}
                className="rounded bg-warning/15 text-warning underline decoration-dotted"
              >
                {s.text}
              </span>
            ) : s.kind ? (
              <span key={i} className="rounded bg-primary-subtle text-primary">
                {s.text}
              </span>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </div>
        <Input
          ref={(el) => {
            ref.current = el;
            if (typeof inputRef === 'function') inputRef(el);
            else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
          }}
          id={id}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          className={cn(
            'relative z-10 !bg-transparent text-sm !text-transparent [caret-color:var(--ink)]',
            bare && '!border-transparent !px-0 !shadow-none !ring-0',
          )}
          onScroll={syncScroll}
          onCompositionStart={() => {
            composingRef.current = true;
            setOpen(false);
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            onChange(e.currentTarget.value);
            refresh();
          }}
          onChange={(e) => {
            setBlurred(false);
            onChange(e.target.value);
            if (!composingRef.current) refresh();
            else syncScroll();
          }}
          onClick={() => {
            if (!composingRef.current) refresh();
          }}
          onKeyUp={(e) => {
            if (!composingRef.current && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key))
              refresh();
            syncScroll();
          }}
          onKeyDown={(e) => {
            // Giữa chừng IME (kể cả Enter xác nhận bộ gõ) → để nguyên cho IME xử lý.
            if (composingRef.current || e.nativeEvent.isComposing) return;
            if (open && items.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => (i + 1) % items.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => (i - 1 + items.length) % items.length);
                return;
              }
              // ⌘/Ctrl+Enter luôn tạo việc (nhường cho Dialog), không chọn gợi ý; Enter/Tab trơn mới chọn.
              const act = shouldAcceptSuggestionOnKey(e, true);
              if (act === 'pass') {
                setOpen(false);
                return;
              }
              if (act === 'accept') {
                e.preventDefault();
                accept(items[idx]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                return;
              }
            }
            // Enter thường (không kèm Cmd/Ctrl) trong ô tiêu đề KHÔNG submit form — submit nhanh chỉ qua ⌘/Ctrl+Enter.
            if (e.key === 'Enter') {
              if (!e.metaKey && !e.ctrlKey) e.preventDefault();
              if (onEnter) {
                e.preventDefault();
                onEnter();
              }
            }
          }}
          onBlur={() => {
            setOpen(false);
            setBlurred(true);
            onBlur?.();
          }}
        />

        {open && items.length > 0 && (
          <ul
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-100"
            role="listbox"
          >
            {items.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === idx}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => accept(s)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink transition-colors',
                    i === idx ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="font-mono text-[11px] text-faint">{s.insert.charAt(0)}</span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.hint && (
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                      {s.hint}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {warns.length > 0 && (
        <p role="status" className="mt-1 text-xs text-warning">
          Chưa nhận ra{' '}
          {warns.map((w) => (
            <code key={w.start} className="mx-0.5 rounded bg-surface-2 px-1">
              {w.text}
            </code>
          ))}{' '}
          — {UNMATCHED_HINT[warns[0]!.kind]}.
        </p>
      )}
    </div>
  );
}
