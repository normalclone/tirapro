import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Gauge, Info, Target, Users } from 'lucide-react';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { RAID_LEVEL_META } from '@/features/raid/constants';
import { cn } from '@/lib/utils';
import { useLeadership } from './api';
import {
  LEADERSHIP_EMPTY,
  LEADERSHIP_HINT,
  goalPaceText,
  overloadDetailText,
  ratioText,
  riskMetaText,
} from './leadershipText';

/**
 * Ba thẻ cho lãnh đạo trên Tổng quan: 5 rủi ro mở điểm cao nhất · OKR chậm so với thời gian · người quá tải.
 * Một request; mỗi thẻ rỗng/ lỗi độc lập (máy chủ trả mảng rỗng cho nguồn lỗi). Bấm "Xem tất cả" tới trang đầy đủ.
 */
export function LeadershipCards() {
  const { data, isLoading, isError } = useLeadership(true);

  if (isLoading) {
    return (
      <div className="grid gap-3 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-10 w-full" />
            <Skeleton className="mt-2 h-10 w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-muted">
        Không tải được rủi ro, OKR và nhân lực. Tải lại trang để thử lại.
      </p>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <LeadershipCard
        icon={<Flame className="h-4 w-4 text-danger" aria-hidden />}
        title="Top rủi ro"
        hint={LEADERSHIP_HINT.risks}
        to="/manage/risks"
        empty={LEADERSHIP_EMPTY.risks}
        count={data.topRisks.length}
      >
        {data.topRisks.map((r) => (
          <li key={r.id}>
            <Link to="/manage/risks" className={rowClass}>
              <span
                className={cn(
                  'tabular w-8 shrink-0 rounded px-1 py-0.5 text-center text-xs font-semibold',
                  RAID_LEVEL_META[r.level].badge,
                )}
                title={`Điểm ${r.score} — mức ${r.levelLabel.toLowerCase()}`}
              >
                {r.score}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{r.title}</span>
                <span className="block truncate text-xs text-muted">
                  {[riskMetaText(r), r.owner?.displayName].filter(Boolean).join(' · ') ||
                    'Chưa có người phụ trách'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </LeadershipCard>

      <LeadershipCard
        icon={<Target className="h-4 w-4 text-warning" aria-hidden />}
        title="OKR chậm"
        hint={LEADERSHIP_HINT.goals}
        to="/manage/goals"
        empty={LEADERSHIP_EMPTY.goals}
        count={data.slowGoals.length}
      >
        {data.slowGoals.map((g) => (
          <li key={g.id}>
            <Link to="/manage/goals" className={cn(rowClass, 'flex-col items-stretch gap-1.5')}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-ink">{g.name}</span>
                {g.owner && (
                  <span className="shrink-0 text-xs text-muted">{g.owner.displayName}</span>
                )}
              </span>
              <PaceBar progress={g.progress} expected={g.expectedProgress} />
              <span className="text-xs text-muted tabular">{goalPaceText(g)}</span>
            </Link>
          </li>
        ))}
      </LeadershipCard>

      <LeadershipCard
        icon={<Users className="h-4 w-4 text-primary" aria-hidden />}
        title="Người quá tải"
        hint={LEADERSHIP_HINT.overloaded}
        to="/manage/resources"
        empty={LEADERSHIP_EMPTY.overloaded}
        count={data.overloaded.length}
      >
        {data.overloaded.map((o) => (
          <li key={o.user.id}>
            <Link to="/manage/resources" className={rowClass}>
              <Avatar name={o.user.displayName} src={o.user.avatarUrl} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{o.user.displayName}</span>
                <span className="block truncate text-xs text-muted tabular">
                  {overloadDetailText(o)}
                </span>
              </span>
              <span className="tabular shrink-0 text-sm font-semibold text-danger">
                {ratioText(o.worstRatio)}
              </span>
            </Link>
          </li>
        ))}
      </LeadershipCard>
    </div>
  );
}

const rowClass =
  'flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none';

function LeadershipCard({
  icon,
  title,
  hint,
  to,
  empty,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  to: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="print-avoid-break rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-strong">
          {icon}
          {title}
          <span
            tabIndex={0}
            role="img"
            aria-label={hint}
            title={hint}
            className="inline-flex rounded text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary print:hidden"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </span>
        </h3>
        <Link
          to={to}
          className="shrink-0 text-xs text-primary hover:underline print:hidden"
          aria-label={`Xem tất cả: ${title}`}
        >
          Xem tất cả →
        </Link>
      </div>
      {count === 0 ? (
        <p className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">
          <Gauge className="h-4 w-4 shrink-0 text-faint" aria-hidden />
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {children}
        </ul>
      )}
    </section>
  );
}

/** Thanh tiến độ thật, vạch đứng đánh dấu phần thời gian đã trôi (chỉ để nhìn; chữ bên dưới đã nói đủ). */
function PaceBar({ progress, expected }: { progress: number; expected: number }) {
  return (
    <span className="relative block h-1.5 rounded-full bg-surface-2" aria-hidden>
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-warning"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
      <span
        className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-ink-strong"
        style={{ left: `${Math.min(100, Math.max(0, expected))}%` }}
      />
    </span>
  );
}
