import { useState } from 'react';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { fmtDate } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import { useQaReport, type QaReport } from './api';
import { Card, StatStrip, type StatItem } from './charts';
import { barWidthPct, formatHours, formatPercent } from './qaFormat';

const PERIODS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;

const VERSION_STATUS: Record<QaReport['byRelease']['rows'][number]['status'], string> = {
  UNRELEASED: 'Chưa phát hành',
  RELEASED: 'Đã phát hành',
  ARCHIVED: 'Lưu trữ',
};

const REOPEN_HINT =
  'Tỷ lệ mở lại = bug vừa được đóng vừa bị mở lại trong kỳ ÷ bug được đóng trong kỳ.';
const CLOSE_TIME_HINT =
  'Thời gian đóng: từ lúc báo đến lúc đóng. Trung vị ít bị lệch bởi vài bug rất lâu nên là số chính; trung bình hiển thị kèm để so.';

function statItems(r: QaReport): StatItem[] {
  return [
    {
      label: 'Bug đang mở',
      value: r.totals.open,
      sub: 'chưa ở trạng thái hoàn thành',
      title: 'Bug chưa ở nhóm trạng thái Hoàn thành, tính tại thời điểm xem (không phụ thuộc kỳ).',
    },
    {
      label: 'Tỷ lệ mở lại',
      value: formatPercent(r.reopenRate),
      sub:
        r.reopenRate == null ? 'chưa có bug đóng trong kỳ' : `trên ${r.totals.closed} bug đã đóng`,
      tone: r.reopenRate != null && r.reopenRate >= 0.2 ? 'warning' : 'default',
      title: REOPEN_HINT,
    },
    {
      label: 'Thời gian đóng (trung vị)',
      value: formatHours(r.closeTime.medianHours),
      sub:
        r.closeTime.sample === 0
          ? 'chưa có bug đóng trong kỳ'
          : `trung bình ${formatHours(r.closeTime.avgHours)} · ${r.closeTime.sample} bug`,
      title: CLOSE_TIME_HINT,
    },
    {
      label: 'Mới / Đã đóng trong kỳ',
      value: `${r.totals.created} / ${r.totals.closed}`,
      sub: r.totals.created > r.totals.closed ? 'bug đang tăng' : 'đóng kịp hoặc nhiều hơn báo mới',
      title: 'Bug báo mới / bug được đóng trong kỳ đã chọn.',
    },
  ];
}

/** Thanh ngang bằng div: một trục, nhãn và số ngay trên thanh (không legend). */
function SeverityBars({ rows }: { rows: QaReport['openBySeverity'] }) {
  const max = Math.max(0, ...rows.map((s) => s.open));
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Không có bug đang mở"
        description="Mọi bug của dự án đã đóng, hoặc dự án chưa có bug nào."
      />
    );
  }
  return (
    <ul className="space-y-2.5" aria-label="Bug đang mở theo mức nghiêm trọng">
      {rows.map((s) => (
        <li
          key={s.severityId ?? 'unset'}
          title={
            s.severityId
              ? `${s.open} bug đang mở ở mức ${s.name}`
              : `${s.open} bug đang mở chưa đặt mức nghiêm trọng`
          }
        >
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className={cn('truncate', s.severityId ? 'text-ink' : 'text-muted')}>
              {s.name}
            </span>
            <span className="tabular font-medium text-ink-strong">{s.open}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{
                width: `${barWidthPct(s.open, max)}%`,
                background: s.color ?? 'var(--faint)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReleaseTable({ byRelease }: { byRelease: QaReport['byRelease'] }) {
  if (byRelease.rows.length === 0) {
    return (
      <EmptyState
        title="Chưa có bug nào gắn phiên bản"
        description="Gắn “Phiên bản bị ảnh hưởng” hoặc “Phiên bản sửa” trong chi tiết bug để thấy bug theo bản phát hành."
      />
    );
  }
  const th = 'px-2 py-1.5 text-xs font-medium text-muted';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className={th}>
              Phiên bản
            </th>
            <th scope="col" className={cn(th, 'text-right')}>
              Tổng
            </th>
            <th scope="col" className={cn(th, 'text-right')}>
              Mở
            </th>
            <th scope="col" className={cn(th, 'text-right')}>
              Đóng
            </th>
            <th
              scope="col"
              className={cn(th, 'text-right')}
              title="Rò rỉ: bug báo sau ngày phát hành của phiên bản đã phát hành."
            >
              Rò rỉ
            </th>
          </tr>
        </thead>
        <tbody>
          {byRelease.rows.map((row) => (
            <tr key={row.versionId} className="border-b border-border last:border-0">
              <th scope="row" className="px-2 py-2 text-left font-normal">
                <span className="font-medium text-ink-strong">{row.name}</span>
                <span className="block text-xs text-muted">
                  {VERSION_STATUS[row.status]}
                  {row.releaseDate ? ` · ${fmtDate(row.releaseDate)}` : ''}
                </span>
              </th>
              <td className="tabular px-2 py-2 text-right text-ink">{row.total}</td>
              <td className="tabular px-2 py-2 text-right text-ink">{row.open}</td>
              <td className="tabular px-2 py-2 text-right text-ink">{row.closed}</td>
              <td
                className={cn(
                  'tabular px-2 py-2 text-right',
                  row.leaked > 0 ? 'font-medium text-danger' : 'text-muted',
                )}
                title="Báo sau ngày phát hành"
              >
                {row.leaked}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mục "Chất lượng (QA)" của trang Báo cáo: số liệu bug của một dự án (chỉ cần quyền xem báo cáo). */
export function QaReportPanel({ projectId }: { projectId: string }) {
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const report = useQaReport(projectId, days);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Chỉ tính công việc loại Bug của dự án này.</p>
        <div
          role="group"
          aria-label="Kỳ báo cáo"
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                'rounded px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                days === d
                  ? 'bg-surface-2 font-medium text-ink-strong'
                  : 'text-muted hover:text-ink',
              )}
            >
              {d} ngày
            </button>
          ))}
        </div>
      </div>

      {report.isError && !report.data ? (
        <QueryError error={report.error} onRetry={() => void report.refetch()} />
      ) : !report.data ? (
        <div className="space-y-4">
          <Skeleton className="h-[84px] w-full" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Skeleton className="h-[260px]" />
            <Skeleton className="h-[260px]" />
          </div>
        </div>
      ) : (
        <div
          className={cn('space-y-4 transition-opacity', report.isPlaceholderData && 'opacity-60')}
        >
          <StatStrip items={statItems(report.data)} className="sm:grid-cols-4" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Bug đang mở theo mức nghiêm trọng">
              <SeverityBars rows={report.data.openBySeverity} />
            </Card>
            <Card
              title={
                report.data.byRelease.basis === 'FIX'
                  ? 'Bug theo phiên bản sửa'
                  : 'Bug theo phiên bản bị ảnh hưởng'
              }
              caption={
                report.data.byRelease.basis === 'FIX'
                  ? 'chưa có bug gắn phiên bản bị ảnh hưởng'
                  : undefined
              }
            >
              <ReleaseTable byRelease={report.data.byRelease} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
