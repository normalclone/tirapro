import { useMemo } from 'react';
import { CalendarRange } from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { RollupGroup } from './api';

const DAY = 86_400_000;

interface Bar {
  key: string;
  label: string;
  sub: string;
  color: string;
  level: 0 | 1;
  start: number;
  end: number;
  pct: number;
}

function ts(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function startOfMonth(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function addMonths(t: number, n: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

function monthLabel(t: number): string {
  const d = new Date(t);
  return `T${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString('vi-VN');
}

/**
 * Roadmap ngang tự vẽ bằng div (không thư viện): mỗi chương trình một thanh đậm,
 * dự án con thanh mảnh hơn. Trục thời gian chia theo tháng, có vạch "hôm nay".
 * Mốc thời gian của dự án suy ra từ issue (ngày bắt đầu sớm nhất → hạn muộn nhất).
 */
export function RoadmapTimeline({ groups }: { groups: RollupGroup[] }) {
  const model = useMemo(() => {
    const bars: Bar[] = [];
    for (const g of groups) {
      const gs = ts(g.startDate);
      const ge = ts(g.targetDate);
      if (gs !== null && ge !== null) {
        bars.push({
          key: `g-${g.id ?? 'none'}`,
          label: g.name,
          sub: `${g.projectCount} dự án · ${g.progressPct}%`,
          color: g.color ?? 'var(--status-progress)',
          level: 0,
          start: gs,
          end: Math.max(ge, gs + DAY),
          pct: g.progressPct,
        });
      }
      for (const p of g.projects) {
        const ps = ts(p.startDate);
        const pe = ts(p.targetDate);
        if (ps === null || pe === null) continue;
        bars.push({
          key: `p-${p.id}`,
          label: p.name,
          sub: `${p.key} · ${p.progressPct}%`,
          color: g.color ?? 'var(--status-todo)',
          level: 1,
          start: ps,
          end: Math.max(pe, ps + DAY),
          pct: p.progressPct,
        });
      }
    }
    if (bars.length === 0) return null;

    const min = Math.min(...bars.map((b) => b.start));
    const max = Math.max(...bars.map((b) => b.end));
    const domainStart = startOfMonth(min);
    const domainEnd = addMonths(startOfMonth(max), 1);
    const span = Math.max(domainEnd - domainStart, DAY);

    const months: { t: number; left: number; width: number }[] = [];
    for (let t = domainStart; t < domainEnd; t = addMonths(t, 1)) {
      const next = addMonths(t, 1);
      months.push({ t, left: ((t - domainStart) / span) * 100, width: ((next - t) / span) * 100 });
    }
    const now = Date.now();
    const todayLeft = now >= domainStart && now <= domainEnd ? ((now - domainStart) / span) * 100 : null;

    return { bars, domainStart, span, months, todayLeft };
  }, [groups]);

  if (!model) {
    return (
      <EmptyState
        icon={<CalendarRange className="h-6 w-6" />}
        title="Chưa có mốc thời gian"
        description="Đặt ngày bắt đầu / ngày mục tiêu cho chương trình, hoặc đặt ngày bắt đầu và hạn hoàn thành cho issue trong dự án."
      />
    );
  }

  const { bars, domainStart, span, months, todayLeft } = model;
  const trackWidth = Math.max(months.length * 72, 420);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[36rem]" style={{ minWidth: `${trackWidth + 208}px` }}>
        {/* Trục tháng */}
        <div className="flex items-end">
          <div className="w-52 shrink-0 pr-3 text-xs font-medium text-faint">Hạng mục</div>
          <div className="relative h-6 flex-1">
            {months.map((m) => (
              <span
                key={m.t}
                className="absolute top-0 border-l border-border pl-1 text-[11px] text-faint"
                style={{ left: `${m.left}%` }}
              >
                {monthLabel(m.t)}
              </span>
            ))}
          </div>
        </div>

        <ul className="mt-1 space-y-1">
          {bars.map((b) => {
            const left = ((b.start - domainStart) / span) * 100;
            const width = Math.max(((b.end - b.start) / span) * 100, 0.8);
            const title = `${b.label}: ${fmtDate(b.start)} → ${fmtDate(b.end)} · hoàn thành ${b.pct}%`;
            return (
              <li key={b.key} className="flex items-center">
                <div className={cn('w-52 shrink-0 pr-3', b.level === 1 && 'pl-4')}>
                  <p className={cn('truncate text-sm', b.level === 0 ? 'font-medium text-ink-strong' : 'text-ink')}>{b.label}</p>
                  <p className="truncate text-[11px] text-faint">{b.sub}</p>
                </div>
                <div className="relative h-9 flex-1">
                  {months.map((m) => (
                    <span key={m.t} className="absolute inset-y-0 border-l border-border" style={{ left: `${m.left}%` }} aria-hidden />
                  ))}
                  {todayLeft !== null && (
                    <span className="absolute inset-y-0 w-px bg-danger" style={{ left: `${todayLeft}%` }} aria-hidden />
                  )}
                  <div
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 overflow-hidden rounded',
                      b.level === 0 ? 'h-5' : 'h-3',
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: `color-mix(in oklch, ${b.color} 22%, transparent)`,
                      border: `1px solid color-mix(in oklch, ${b.color} 45%, transparent)`,
                    }}
                    title={title}
                    role="img"
                    aria-label={title}
                  >
                    <span className="block h-full" style={{ width: `${b.pct}%`, backgroundColor: b.color, opacity: 0.55 }} aria-hidden />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {todayLeft !== null && (
          <p className="mt-3 flex items-center gap-1.5 pl-52 text-[11px] text-faint">
            <span className="inline-block h-3 w-px bg-danger" aria-hidden /> Hôm nay
          </p>
        )}
      </div>
    </div>
  );
}
