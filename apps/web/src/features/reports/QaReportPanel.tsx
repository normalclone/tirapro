import { useState } from 'react';
import { Bug, Tag } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { fmtDate } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import { useQaReport, type QaReport } from './api';
import { Card, StatStrip, type StatItem } from './charts';
import { barWidthPct, formatHours, formatPercent, shouldWarnReopen } from './qaFormat';
import { ScrollX } from '@/components/ui/ScrollX';

const PERIODS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;

const VERSION_STATUS: Record<QaReport['byRelease']['rows'][number]['status'], string> = {
  UNRELEASED: 'Chưa phát hành',
  RELEASED: 'Đã phát hành',
  ARCHIVED: 'Lưu trữ',
};

const REOPEN_HINT =
  'Tỷ lệ mở lại = bug vừa được đóng vừa bị mở lại trong kỳ ÷ bug được đóng trong kỳ. Bug đóng, mở lại rồi đóng lại trong kỳ vẫn tính là mở lại.';
const CLOSE_TIME_HINT =
  'Thời gian đóng: từ lúc báo đến lúc đóng. Trung vị ít bị lệch bởi vài bug rất lâu nên là số chính; trung bình hiển thị kèm để so. Chỉ tính bug hiện đang đóng, nên có thể ít hơn số bug “đã đóng” trong kỳ (bug bị mở lại không tính).';

function statItems(r: QaReport): StatItem[] {
  return [
    {
      label: 'Bug đang mở',
      value: r.totals.open,
      sub: 'chưa hoàn thành',
      title: 'Bug chưa ở nhóm trạng thái Hoàn thành, tính tại thời điểm xem (không phụ thuộc kỳ).',
    },
    {
      label: 'Tỷ lệ mở lại',
      value: formatPercent(r.reopenRate),
      sub:
        r.reopenRate == null
          ? 'chưa có bug đóng trong kỳ'
          : `trên ${r.totals.closed} bug đóng trong kỳ`,
      tone: shouldWarnReopen(r.reopenRate, r.totals.closed) ? 'warning' : 'default',
      title: REOPEN_HINT,
    },
    {
      label: 'Thời gian đóng (trung vị)',
      value: formatHours(r.closeTime.medianHours),
      sub:
        r.closeTime.sample === 0
          ? 'chưa có bug đóng trong kỳ'
          : `TB ${formatHours(r.closeTime.avgHours)} · ${r.closeTime.sample} bug`,
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
        size="compact"
        icon={<Bug />}
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
                background:
                  s.color ??
                  'repeating-linear-gradient(135deg, var(--faint) 0 4px, transparent 4px 8px)',
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
        size="compact"
        icon={<Tag />}
        title="Chưa có bug nào gắn phiên bản"
        description="Gắn “Phiên bản bị ảnh hưởng” hoặc “Phiên bản sửa” trong chi tiết bug để thấy bug theo bản phát hành."
      />
    );
  }
  const th = 'px-2 py-1.5 text-xs font-medium text-muted';
  // "Rò rỉ" chỉ có nghĩa với phiên bản bị ảnh hưởng (bug phát hiện SAU phát hành); với phiên bản sửa thì ẩn cột.
  const showLeaked = byRelease.basis === 'AFFECTS';
  return (
    <ScrollX>
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
            {showLeaked && (
              <th
                scope="col"
                className={cn(th, 'text-right')}
                title="Rò rỉ: bug báo sau ngày phát hành của phiên bản đã phát hành."
              >
                Rò rỉ
              </th>
            )}
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
              {showLeaked && (
                <td
                  className={cn(
                    'tabular px-2 py-2 text-right',
                    row.leaked > 0 ? 'font-medium text-danger' : 'text-muted',
                  )}
                  title="Báo sau ngày phát hành"
                >
                  {row.leaked}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

/** Mục "Chất lượng (QA)" của trang Báo cáo: số liệu bug của một dự án (chỉ cần quyền xem báo cáo). */
export function QaReportPanel({ projectId }: { projectId: string }) {
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const report = useQaReport(projectId, days);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Chỉ tính công việc loại Bug đã qua duyệt của dự án này
          {report.data
            ? ` · kỳ ${fmtDate(report.data.range.from)} – ${fmtDate(report.data.range.to)}`
            : ''}
          .
        </p>
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
                  ? 'mọi thời điểm · chưa có bug gắn phiên bản bị ảnh hưởng'
                  : 'mọi thời điểm, không theo kỳ'
              }
            >
              <ReleaseTable byRelease={report.data.byRelease} />
            </Card>
          </div>
          <Definitions />
        </div>
      )}
    </div>
  );
}

/** Cách tính — dùng được bằng bàn phím và cảm ứng (tooltip `title` chỉ có khi rê chuột). */
function Definitions() {
  return (
    <details className="rounded-lg border border-border bg-surface px-4 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        Cách tính các số liệu
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
        <li>
          Chỉ tính công việc loại Bug. Bug đang chờ duyệt, tạm hoãn hoặc bị từ chối ở “Việc mới vào”
          không tính.
        </li>
        <li>
          Bug đang mở: chưa ở nhóm trạng thái Hoàn thành, tại thời điểm xem (không phụ thuộc kỳ).
        </li>
        <li>
          Đã đóng: bug được chuyển sang trạng thái Hoàn thành trong kỳ. Chuyển giữa hai trạng thái
          đã hoàn thành không tính.
        </li>
        <li>{REOPEN_HINT}</li>
        <li>{CLOSE_TIME_HINT}</li>
        <li>
          Theo phiên bản: tính mọi thời điểm. Rò rỉ = bug báo sau hết ngày phát hành của phiên bản
          đã phát hành.
        </li>
      </ul>
    </details>
  );
}
