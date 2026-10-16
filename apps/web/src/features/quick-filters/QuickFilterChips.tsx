import { cn } from '@/lib/utils';
import { CHIP_ROW_GAP_COARSE, CHIP_TOUCH_HIT, MOBILE_SCROLL_STRIP } from '@/lib/touchHit';
import { useScrollFade } from '@/lib/useScrollFade';
import { QUICK_FILTERS, type QuickFilterId } from './useQuickFilters';

/**
 * Hàng chip lọc nhanh. Bấm để bật/tắt; bật nhiều chip cùng lúc thì việc phải khớp tất cả.
 * Trạng thái bật = nền primary-subtle + chữ primary; tắt = viền.
 * Dưới `sm`: một dòng RIÊNG trên cùng thanh công cụ (`order-first`, rộng cả hàng), không xuống dòng, cuộn ngang,
 * ẩn thanh cuộn, mờ mép báo còn chip. Thanh chứa phải có lề ngang `px-4` ở mobile → hàng tràn sát mép màn hình
 * (`-mx-4`); chip đang bật tự cuộn vào khung.
 */
export function QuickFilterChips({
  active,
  onToggle,
  className,
}: {
  active: Set<QuickFilterId>;
  onToggle: (id: QuickFilterId) => void;
  className?: string;
}) {
  const { ref, style } = useScrollFade<HTMLDivElement>(
    [...active].join(','),
    '[aria-pressed="true"]',
  );
  return (
    <div
      ref={ref}
      style={style}
      role="group"
      aria-label="Bộ lọc nhanh"
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-2',
        CHIP_ROW_GAP_COARSE,
        // Mobile: một dòng riêng, cuộn ngang (`relative` để tính vị trí chip khi tự cuộn).
        MOBILE_SCROLL_STRIP,
        'max-sm:order-first',
        className,
      )}
    >
      {QUICK_FILTERS.map((f) => {
        const isOn = active.has(f.id);
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={isOn}
            title={isOn ? `${f.hint} · bấm để tắt bộ lọc` : f.hint}
            onClick={() => onToggle(f.id)}
            className={cn(
              'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition-colors',
              CHIP_TOUCH_HIT,
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              isOn
                ? 'border-transparent bg-primary-subtle text-primary'
                : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
