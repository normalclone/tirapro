import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Equal } from 'lucide-react';
import { priorityGlyph, type PriorityGlyph } from '@/lib/priorityGlyph';
import { cn } from '@/lib/utils';

const GLYPH_ICON = {
  highest: ChevronsUp,
  high: ChevronUp,
  medium: Equal,
  low: ChevronDown,
  lowest: ChevronsDown,
} as const satisfies Record<PriorityGlyph, typeof Equal>;

/**
 * Mức ưu tiên dạng mũi tên (hạng cao → mũi tên lên) tô màu cấu hình: không chỉ dựa vào màu.
 * `withLabel` → thêm tên bằng chữ thật (icon khi đó chỉ trang trí).
 */
export function PriorityIcon({
  name,
  rank,
  ranks,
  color,
  className,
  withLabel,
}: {
  name: string;
  rank: number;
  /** Mọi hạng hiện có (từ danh sách ưu tiên đã tải) — để suy mũi tên. */
  ranks: readonly number[];
  /** Màu cấu hình; null → `var(--muted)`. */
  color?: string | null;
  className?: string;
  withLabel?: boolean;
}) {
  const Icon = GLYPH_ICON[priorityGlyph(rank, ranks)];
  const label = `Ưu tiên: ${name}`;
  const style = { color: color ?? 'var(--muted)' };
  const icon = (
    <Icon
      strokeWidth={2.5}
      className={cn('h-3.5 w-3.5 shrink-0', className)}
      style={style}
      {...(withLabel ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  );
  if (!withLabel)
    return (
      <span title={label} className="inline-flex shrink-0">
        {icon}
      </span>
    );
  return (
    <span title={label} className="inline-flex min-w-0 items-center gap-1.5">
      {icon}
      <span className="truncate">{name}</span>
    </span>
  );
}
