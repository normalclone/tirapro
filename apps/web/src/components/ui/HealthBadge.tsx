import * as Popover from '@radix-ui/react-popover';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, PenLine, XOctagon } from 'lucide-react';
import type { ProjectHealthDto, ProjectHealthLevel } from '@tirapro/shared';
import { fmtRelative } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import { healthAutoText, healthLabel } from './healthLabel';

/** Mỗi mức một HÌNH icon khác nhau + chữ → không phụ thuộc màu (a11y). Màu chỉ là lớp phụ. */
const TONE: Record<
  ProjectHealthLevel,
  { icon: typeof CheckCircle2; chip: string; iconCls: string }
> = {
  GREEN: {
    icon: CheckCircle2,
    chip: 'border-success/40 bg-success/10',
    iconCls: 'text-success',
  },
  YELLOW: {
    icon: AlertTriangle,
    chip: 'border-warning/50 bg-warning/10',
    iconCls: 'text-warning-ink',
  },
  RED: { icon: XOctagon, chip: 'border-danger/40 bg-danger/10', iconCls: 'text-danger' },
  NONE: { icon: CircleDashed, chip: 'border-border bg-surface-2', iconCls: 'text-muted' },
};

export function HealthDetails({
  health,
  showLevel = true,
}: {
  health: ProjectHealthDto | null;
  /** Ẩn dòng mức khi nơi dùng đã hiện huy hiệu ngay trên. */
  showLevel?: boolean;
}) {
  if (!health) return <p className="text-sm text-muted">Chưa có dữ liệu sức khoẻ cho dự án này.</p>;
  return (
    <div className="space-y-2 text-sm">
      {showLevel && <p className="font-medium text-ink-strong">{healthLabel(health.level)}</p>}
      {health.override && (
        <p className="text-ink">
          <span className="text-muted">
            Đặt bởi {health.override.updatedBy?.displayName ?? 'một thành viên'} ·{' '}
            {fmtRelative(health.override.updatedAt)} —{' '}
          </span>
          “{health.override.note}”
        </p>
      )}
      <div className={cn(health.override && 'border-t border-border pt-2')}>
        <p className="text-xs text-muted">
          {health.override ? healthAutoText({ ...health.auto, reasons: [] }) : 'Tự tính'}
        </p>
        {health.auto.reasons.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink">
            {health.auto.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted">
            {health.auto.level === 'GREEN' ? 'Chưa thấy dấu hiệu rủi ro.' : 'Chưa có lý do.'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Huy hiệu sức khoẻ dự án: icon + nhãn chữ (không chỉ màu). Bấm mở popover lý do tự tính + ghi chú PM
 * (nếu có ghi đè) và liên kết "Đổi ở Báo cáo dự án" khi biết `projectKey`.
 * `compact` ẩn chữ dưới `md` (icon vẫn có tên truy cập) để hàng bảng nhiều cột không tràn trên di động.
 */
export function HealthBadge({
  health,
  compact,
  projectKey,
  className,
}: {
  health: ProjectHealthDto | null;
  compact?: boolean;
  projectKey?: string;
  className?: string;
}) {
  const level: ProjectHealthLevel = health?.level ?? 'NONE';
  const tone = TONE[level];
  const Icon = tone.icon;
  const label = healthLabel(level);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Sức khoẻ dự án: ${label}. Bấm xem lý do`}
          title="Bấm để xem lý do"
          data-health={level}
          className={cn(
            'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium text-ink transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            tone.chip,
            className,
          )}
        >
          <Icon className={cn('h-3.5 w-3.5 shrink-0', tone.iconCls)} aria-hidden />
          <span className={cn(compact && 'hidden md:inline print:inline')}>{label}</span>
          {health?.override && <PenLine className="h-3 w-3 shrink-0 text-faint" aria-hidden />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-72 rounded-lg border border-border bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 print:hidden"
        >
          <HealthDetails health={health} />
          {projectKey && (
            <Link
              to={`/p/${projectKey}/reports?tab=overview`}
              className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
            >
              Đổi ở Báo cáo dự án →
            </Link>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
