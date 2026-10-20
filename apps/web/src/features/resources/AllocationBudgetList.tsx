import { TriangleAlert } from 'lucide-react';
import { Avatar } from '@/components/ui/primitives';
import { LimitMeter } from '@/components/ui/LimitMeter';
import { fmtDayMonth } from '@/lib/dateFormat';
import type { PersonBudget } from './allocationBudget';

/**
 * Ngân sách thời gian theo người (171): một `LimitMeter` (tông strict) cho ĐỈNH tổng phân bổ chồng nhau trong khoảng, kèm chia
 * theo dự án tại ngày đỉnh bằng chữ và cảnh báo khi > 100% (chỉ cảnh báo — máy chủ không chặn). `only`: chỉ hiện những người này
 * (bảng đang lọc theo dự án); con số luôn là tổng MỌI dự án.
 */
export function AllocationBudgetList({
  budgets,
  only,
}: {
  budgets: readonly PersonBudget[];
  only?: readonly string[];
}) {
  const shown = only ? budgets.filter((b) => only.includes(b.userId)) : budgets;
  if (shown.length === 0) return null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {shown.map((b) => {
        const over = b.peak.percent > 100;
        const peakDay = fmtDayMonth(b.peak.day);
        return (
          <li
            key={b.userId}
            className="grid items-center gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={b.name} size={24} />
              <span className="truncate text-sm text-ink">{b.name}</span>
            </span>
            <div className="min-w-0 space-y-1">
              <LimitMeter
                used={b.peak.percent}
                limit={100}
                prefix="Đỉnh"
                unit="%"
                label={`Ngân sách thời gian của ${b.name}`}
                labels={{ over: (n) => `Vượt ${n}%` }}
                tone="strict"
                description={`Tổng phân bổ chồng nhau cao nhất trong khoảng đang xem: ${b.peak.percent}% vào ${peakDay}.`}
              />
              <p className="text-xs text-muted">
                <span className="text-faint">Ngày {peakDay}:</span>{' '}
                {b.perProject.map((p, i) => (
                  <span key={p.projectId} title={p.name}>
                    {i > 0 && ' · '}
                    <span className="font-mono">{p.key}</span> {p.percent}%
                  </span>
                ))}
              </p>
              {over && (
                <p className="flex items-start gap-1 text-xs text-danger">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Đỉnh {b.peak.percent}% vào {peakDay}
                    {b.overDays > 0 && ` — ${b.overDays} ngày làm việc vượt 100%`}. Đây là cảnh báo,
                    hệ thống không chặn.
                  </span>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
