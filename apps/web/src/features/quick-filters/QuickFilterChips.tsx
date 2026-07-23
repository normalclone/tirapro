import { cn } from '@/lib/utils';
import { QUICK_FILTERS, type QuickFilterId } from './useQuickFilters';

/**
 * Hàng chip lọc nhanh. Bấm để bật/tắt; nhiều chip bật cùng lúc (AND).
 * Trạng thái bật = nền primary-subtle + chữ primary; tắt = viền.
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
  return (
    <div role="group" aria-label="Bộ lọc nhanh" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {QUICK_FILTERS.map((f) => {
        const isOn = active.has(f.id);
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={isOn}
            onClick={() => onToggle(f.id)}
            className={cn(
              'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors',
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
