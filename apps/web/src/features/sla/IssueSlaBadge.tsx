import { AlarmClock, CheckCircle2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIssueSla, fmtMins, SLA_SOON_MINS } from './api';

/** Nhãn cam kết thời gian xử lý trên trang chi tiết công việc: còn bao lâu / đã trễ / đã xong. */
export function IssueSlaBadge({ issueId }: { issueId: string }) {
  const { data } = useIssueSla(issueId);
  if (!data) return null;

  const resolved = !!data.resolvedAt;
  const breached = data.resolveBreached;
  const mins = data.resolveRemainingMins ?? 0;
  // Xong nhưng vẫn quá hạn: KHÔNG được hiện xanh như đạt cam kết.
  const lateDone = resolved && breached;
  const soon = !resolved && !breached && mins <= SLA_SOON_MINS;

  const tone = lateDone
    ? 'border-warning/40 bg-warning/15 text-warning'
    : resolved
      ? 'border-success/40 bg-success/10 text-success'
      : breached
        ? 'border-danger/40 bg-danger/10 text-danger'
        : soon
          ? 'border-warning/40 bg-warning/15 text-warning'
          : 'border-border bg-surface-2 text-muted';

  const Icon = lateDone ? TriangleAlert : resolved ? CheckCircle2 : breached ? TriangleAlert : AlarmClock;
  const label = lateDone
    ? `Xong nhưng trễ hạn ${fmtMins(mins)}`
    : resolved
      ? 'Đã xử lý xong'
      : breached
        ? `Trễ hạn ${fmtMins(mins)}`
        : `Còn ${fmtMins(mins)} tới hạn xử lý`;

  const title = [
    'Cam kết thời gian xử lý — hệ thống bấm giờ từ lúc công việc được tạo.',
    `Cam kết áp dụng: ${data.policyName}`,
    `Phải phản hồi trước: ${new Date(data.responseDueAt).toLocaleString('vi-VN')}${data.firstRespondedAt ? ' (đã phản hồi)' : ' (chưa phản hồi)'}`,
    `Phải xử lý xong trước: ${new Date(data.resolveDueAt).toLocaleString('vi-VN')}`,
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
