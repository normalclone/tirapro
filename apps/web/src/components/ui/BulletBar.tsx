import { cn } from '@/lib/utils';
import { bulletDelta, bulletGeometry, bulletValueText, type BulletMarker } from './bullet';

type BulletTone = 'primary' | 'progress' | 'done' | 'warning' | 'danger' | 'neutral';

const FILL: Record<BulletTone, string> = {
  primary: 'bg-primary',
  progress: 'bg-status-progress',
  done: 'bg-status-done',
  warning: 'bg-warning-fill',
  danger: 'bg-danger',
  neutral: 'bg-muted',
};

export interface BulletBarProps {
  /** Giá trị thực tế (thanh). */
  value: number;
  /** Đích (vạch đứng đậm), vd cam kết / kỳ vọng theo thời gian / velocity TB. */
  target?: number;
  /** Tên của đích dùng trong chữ: "so với {targetLabel} ±n". */
  targetLabel?: string;
  /** Thang tối đa (vd 100 cho %). Bỏ trống → tự theo giá trị lớn nhất. */
  max?: number;
  /** Đơn vị trong chữ ("điểm", "%"). */
  unit?: string;
  /** Vạch phụ nhạt hơn (vd cam kết lúc bắt đầu sprint). */
  markers?: BulletMarker[];
  /** Tên truy cập của thanh. */
  label: string;
  tone?: BulletTone;
  size?: 'sm' | 'md';
  /** Hiện dòng "so với …" dưới thanh (mặc định có khi có đích). Bỏ khi ngay cạnh đã có chữ tương đương. */
  showDelta?: boolean;
  className?: string;
}

/**
 * Thanh tiến độ có vạch đích: phần đã đạt + vạch đứng 2px (đích) + dòng chữ "so với cam kết ±n".
 * `role="meter"`; `aria-valuenow` kẹp trong [0, max], số thật nằm ở `aria-valuetext` (đủ cả đích và chênh lệch) nên
 * màu/vạch không phải kênh duy nhất; dòng chữ nhìn thấy là `aria-hidden` vì trùng valuetext. Không gradient;
 * in được đen trắng (vạch đậm + chữ).
 */
export function BulletBar({
  value,
  target,
  targetLabel = 'đích',
  max,
  unit,
  markers,
  label,
  tone = 'primary',
  size = 'sm',
  showDelta = true,
  className,
}: BulletBarProps) {
  const g = bulletGeometry({ value, target, max, markers });
  const valueText = bulletValueText({ label, value, target, max, targetLabel, unit, markers });
  const hasTarget = g.targetPct !== null && target !== undefined;
  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={g.now}
        aria-valuemin={0}
        aria-valuemax={g.max}
        aria-valuetext={valueText}
        className={cn('relative w-full rounded-full bg-border', size === 'md' ? 'h-2' : 'h-1.5')}
      >
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-base motion-reduce:transition-none',
            FILL[tone],
          )}
          style={{ width: `${g.fillPct}%` }}
        />
        {g.markers.map((m) => (
          <span
            key={m.label}
            title={m.label}
            className="absolute -top-0.5 -bottom-0.5 w-px -translate-x-1/2 bg-muted"
            style={{ left: `${m.pct}%` }}
          />
        ))}
        {hasTarget && (
          <span
            className="absolute -bottom-[3px] -top-[3px] w-0.5 -translate-x-1/2 rounded-sm bg-ink-strong"
            style={{ left: `${g.targetPct}%` }}
          />
        )}
      </div>
      {showDelta && hasTarget && (
        <p aria-hidden="true" className="tabular mt-1 text-xs text-muted">
          {bulletDelta(value, target, targetLabel, unit)}
        </p>
      )}
    </div>
  );
}
