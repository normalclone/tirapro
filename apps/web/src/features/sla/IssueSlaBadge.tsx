import { AlarmClock, CheckCircle2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIssueSla, fmtMins } from './api';

/** Badge SLA trên trang chi tiết issue: còn bao lâu / đã trễ / đã xong. */
export function IssueSlaBadge({ issueId }: { issueId: string }) {
  const { data } = useIssueSla(issueId);
  if (!data) return null;

  const resolved = !!data.resolvedAt;
  const breached = data.resolveBreached;
  const mins = data.resolveRemainingMins ?? 0;
  const soon = !resolved && !breached && mins <= 120;

  const tone = resolved
    ? 'border-success/40 bg-success/10 text-success'
    : breached
      ? 'border-danger/40 bg-danger/10 text-danger'
      : soon
        ? 'border-warning/40 bg-warning/15 text-warning'
        : 'border-border bg-surface-2 text-muted';

  const Icon = resolved ? CheckCircle2 : breached ? TriangleAlert : AlarmClock;
  const label = resolved
    ? 'SLA: đã giải quyết'
    : breached
      ? `SLA: trễ ${fmtMins(mins)}`
      : `SLA: còn ${fmtMins(mins)}`;

  const title = [
    `Chính sách: ${data.policyName}`,
    `Hạn phản hồi: ${new Date(data.responseDueAt).toLocaleString('vi-VN')}${data.firstRespondedAt ? ' (đã phản hồi)' : ''}`,
    `Hạn giải quyết: ${new Date(data.resolveDueAt).toLocaleString('vi-VN')}`,
  ].join('\n');

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium', tone)}
      title={title}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
      {!resolved && !data.firstRespondedAt && (
        <span className="ml-0.5 rounded bg-surface px-1 text-[10px] text-muted">chưa phản hồi</span>
      )}
    </span>
  );
}
