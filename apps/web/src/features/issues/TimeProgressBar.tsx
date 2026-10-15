import { formatDuration } from '@tirapro/shared';
import { cn } from '@/lib/utils';
import { timeProgress } from './timeProgress';

/** Thanh tiến độ: phần đã làm / ước lượng gốc; vượt ước lượng đổi sang màu cảnh báo. */
export function TimeProgressBar({
  spent,
  original,
  remaining,
  canEstimate,
}: {
  spent: number;
  original: number | null;
  remaining: number | null;
  /** Được đặt ước lượng (xem `useCanEditIssue`): quyết định câu gợi ý — nút đặt ước lượng nằm ở dòng dưới của panel. */
  canEstimate: boolean;
}) {
  const { pct, over } = timeProgress(spent, original);
  return (
    <div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(pct === null
          ? { 'aria-valuetext': 'Chưa có ước lượng gốc' }
          : { 'aria-valuenow': pct })}
        aria-label="Tiến độ thời gian"
        className="h-2 overflow-hidden rounded-full bg-surface-3"
      >
        {pct !== null && (
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-slow',
              over ? 'bg-warning' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <Stat label="Đã làm" value={spent > 0 ? formatDuration(spent) : '0m'} />
        <Stat label="Ước lượng" value={original ? formatDuration(original) : '—'} />
        <Stat
          label="Còn lại"
          value={remaining !== null ? formatDuration(remaining) : '—'}
          warn={over}
        />
      </dl>
      {pct === null && (
        <p className="mt-1.5 text-xs text-muted">
          {canEstimate
            ? 'Chưa có ước lượng gốc — đặt ước lượng để xem tiến độ.'
            : 'Chưa có ước lượng gốc.'}
        </p>
      )}
      {over && (
        <p className="mt-1.5 text-xs text-warning">
          Đã vượt ước lượng gốc {formatDuration(spent - (original ?? 0))}.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className={cn('font-semibold tabular-nums', warn ? 'text-warning' : 'text-ink')}>
        {value}
      </dd>
    </div>
  );
}
