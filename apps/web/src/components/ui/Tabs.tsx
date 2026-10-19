import {
  useRef,
  type HTMLAttributes,
  type MutableRefObject,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { nextEnabledRadioIndex } from '@/lib/radioNav';
import { useScrollFade } from '@/lib/useScrollFade';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Gợi ý khi rê chuột (mô tả dài hơn nhãn). */
  title?: string;
  disabled?: boolean;
}

/** `id` của nút tab / của tabpanel — cặp `aria-controls` ↔ `aria-labelledby` (thuần để test). */
export const tabIds = (base: string, id: string) => ({
  tab: `${base}-tab-${id}`,
  panel: `${base}-panel`,
});

/**
 * Chỉ số tab kế tiếp theo phím cho tablist NGANG: ←/→ (vòng tròn, bỏ qua tab tắt), Home/End về tab bật đầu/cuối.
 * ↑/↓ không điều hướng (khác radiogroup). Null nếu phím không điều hướng hoặc không còn tab bật khác.
 */
export function nextTabIndex(
  key: string,
  index: number,
  disabled: readonly boolean[],
): number | null {
  if (key === 'ArrowUp' || key === 'ArrowDown') return null;
  return nextEnabledRadioIndex(key, index, disabled);
}

const TAB_BASE =
  'shrink-0 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:text-disabled-fg';
const STYLES = {
  underline: {
    list: 'flex gap-1 border-b border-border',
    tab: '-mb-px border-b-2 px-3 py-2 text-sm',
    on: 'border-primary text-ink-strong',
    off: 'border-transparent text-muted hover:text-ink',
  },
  pill: {
    list: 'flex rounded-md border border-border bg-surface p-0.5',
    tab: 'rounded px-3 py-1 text-xs',
    on: 'bg-primary-subtle text-primary',
    off: 'text-muted hover:text-ink',
  },
} as const;

/**
 * Hàng tab đúng mẫu ARIA (APG): `tablist` > `tab` có `aria-selected`, roving tabindex (chỉ tab đang chọn là điểm dừng
 * Tab), ←/→/Home/End chuyển tab VÀ kích hoạt ngay (automatic activation), `aria-controls` trỏ tới `TabPanel`
 * cùng `idBase`. Chuyển bằng state cùng trang — điều hướng theo URL/route thì dùng liên kết có `aria-current`, không dùng Tabs.
 * - `variant`: `underline` (gạch chân, mặc định) hoặc `pill` (hộp nhỏ). `fade`: hàng cuộn ngang có mờ mép còn nội dung (nơi dùng tự đặt `overflow-x-auto` qua className).
 * - Bắt buộc `ariaLabel` (tên của tablist).
 */
export function Tabs<T extends string>({
  idBase,
  value,
  onChange,
  items,
  ariaLabel,
  variant = 'underline',
  fade = false,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'role' | 'aria-label'> & {
  idBase: string;
  value: T;
  onChange: (id: T) => void;
  items: readonly TabItem<T>[];
  ariaLabel: string;
  variant?: keyof typeof STYLES;
  fade?: boolean;
}) {
  const s = STYLES[variant];
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollFade = useScrollFade<HTMLDivElement>(value, '[aria-selected="true"]');
  const entry = items.some((t) => t.id === value && !t.disabled)
    ? value
    : items.find((t) => !t.disabled)?.id;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = nextTabIndex(
      e.key,
      i,
      items.map((t) => !!t.disabled),
    );
    if (next === null) return;
    e.preventDefault();
    nodes[next]!.focus();
    onChange(items[next]!.id);
  }

  return (
    <div
      {...rest}
      ref={(el) => {
        listRef.current = el;
        if (fade) (scrollFade.ref as MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      style={fade ? scrollFade.style : rest.style}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(s.list, fade && 'scroll-fade-x relative', className)}
    >
      {items.map((t) => {
        const ids = tabIds(idBase, t.id);
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={on}
            aria-controls={ids.panel}
            tabIndex={t.id === entry ? 0 : -1}
            disabled={t.disabled}
            title={t.title}
            onClick={() => onChange(t.id)}
            className={cn(TAB_BASE, s.tab, on ? s.on : s.off)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Nội dung của tab đang chọn: `role="tabpanel"` trỏ ngược về nút tab (`aria-labelledby`). */
export function TabPanel({
  idBase,
  value,
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'id' | 'aria-labelledby'> & {
  idBase: string;
  value: string;
}) {
  const ids = tabIds(idBase, value);
  return (
    <div {...rest} role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} className={className}>
      {children}
    </div>
  );
}
