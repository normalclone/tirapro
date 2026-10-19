import { useId } from 'react';
import { cn } from '@/lib/utils';
import { limitLevel, type LimitLevel } from './limitLevel';

type StateLabels = {
  ok?: string;
  warn?: string;
  full?: string;
  over?: (over: number) => string;
};

const DEFAULT_LABELS: Required<StateLabels> = {
  ok: '',
  warn: 'Gần đầy',
  full: 'Đầy',
  over: (n: number) => `Vượt ${n}`,
};

const BAR: Record<Exclude<LimitLevel, 'none'>, string> = {
  ok: 'bg-muted',
  warn: 'bg-warning',
  full: 'bg-danger',
  over: 'bg-danger',
};
const TEXT: Record<Exclude<LimitLevel, 'none'>, string> = {
  ok: 'text-muted',
  warn: 'text-warning-ink',
  full: 'text-danger',
  over: 'font-semibold text-danger',
};

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * Đồng hồ hạn mức: thanh mảnh + chữ "đã dùng/giới hạn" + nhãn trạng thái (Gần đầy / Đầy / Vượt N).
 * Màu chỉ làm rõ thêm — chữ luôn có. `role="meter"`; `aria-valuemax` luôn là giới hạn (vượt thì valuenow > valuemax).
 * Không có giới hạn dùng được → không render. Dùng cho WIP cột (Board) và sức chứa sprint (Backlog).
 */
export function LimitMeter({
  used,
  limit,
  label,
  prefix,
  unit,
  labels,
  description,
  className,
}: {
  used: number;
  limit: number | null | undefined;
  /** Tên truy cập của đồng hồ (vd "Giới hạn WIP"). */
  label: string;
  /** Chữ đứng trước số (vd "WIP"). */
  prefix?: string;
  /** Đơn vị sau số (vd "điểm"). */
  unit?: string;
  /** Ghi đè nhãn trạng thái theo ngữ cảnh. */
  labels?: StateLabels;
  /** Giải thích dài — qua `aria-describedby` và tooltip, không nằm trong tên. */
  description?: string;
  className?: string;
}) {
  const descId = useId();
  const { level, pct, over } = limitLevel(used, limit);
  if (level === 'none' || limit == null) return null;
  const stateText =
    level === 'over'
      ? (labels?.over ?? DEFAULT_LABELS.over)(over)
      : (labels?.[level] ?? DEFAULT_LABELS[level]);
  const value = `${fmt(used)}/${fmt(limit)}`;
  const shown = `${prefix ? `${prefix} ` : ''}${value}${unit ? ` ${unit}` : ''}`;
  const text = stateText ? `${shown} — ${stateText}` : shown;
  const valueText = `${value}${unit ? ` ${unit}` : ''}${stateText ? ` — ${stateText}` : ''}`;
  return (
    <div className={cn('min-w-0', className)} title={description}>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuetext={valueText}
        aria-describedby={description ? descId : undefined}
        className="h-1 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-base motion-reduce:transition-none',
            BAR[level],
          )}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <p className={cn('tabular mt-1 text-[11px] leading-4', TEXT[level])}>{text}</p>
      {description && (
        <span id={descId} className="sr-only">
          {description}
        </span>
      )}
    </div>
  );
}
