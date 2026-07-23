import { type ReactNode } from 'react';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  ArrowRight,
  ArrowUpDown,
  CircleDot,
  History,
  Layers,
  Tag,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useProject } from '@/features/projects/api';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { pageContainer } from '@/components/layout/page';
import { useProjectActivity, type ProjectActivityItem } from './api';

/** Màu chấm theo status category (dùng CSS var giống IssueProperties). */
function categoryColor(cat: string | null): string {
  switch (cat) {
    case 'DONE':
      return 'var(--status-done)';
    case 'IN_PROGRESS':
      return 'var(--status-progress)';
    case 'TODO':
      return 'var(--status-todo)';
    default:
      return 'var(--faint)';
  }
}

/** Icon nhỏ theo loại hành động (field), giúp quét nhanh loại thay đổi. */
function fieldIcon(field: string): LucideIcon {
  switch (field) {
    case 'STATUS':
      return ArrowRight;
    case 'ASSIGNEE':
      return UserCog;
    case 'PRIORITY':
      return ArrowUpDown;
    case 'STORY_POINTS':
      return Layers;
    case 'SPRINT':
      return Layers;
    case 'TYPE':
      return Tag;
    default:
      return CircleDot;
  }
}

/** Chip giá trị cũ/mới — nền chìm, không viền màu (tránh side-stripe). */
function ValueChip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.8125rem] font-medium text-ink-strong">
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />}
      {children}
    </span>
  );
}

/** Chuyển old→new thành cặp chip có mũi tên. Bỏ vế trống. */
function delta(oldLabel: ReactNode, newLabel: ReactNode): ReactNode {
  const hasOld = oldLabel != null && oldLabel !== '';
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {hasOld && <ValueChip>{oldLabel}</ValueChip>}
      {hasOld && <ArrowRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />}
      <ValueChip>{newLabel ?? '—'}</ValueChip>
    </span>
  );
}

/**
 * Vế "đã <làm gì>" của câu — trả về mảnh JSX đọc tự nhiên theo từng loại field.
 * Actor và issue đích được render riêng ở component cha để giữ câu gọn.
 */
function actionPhrase(a: ProjectActivityItem): ReactNode {
  const oldV = a.oldLabel ?? a.oldValue;
  const newV = a.newLabel ?? a.newValue;
  switch (a.field) {
    case 'STATUS':
      return (
        <>
          đã đổi <span className="text-muted">trạng thái</span>{' '}
          <span className="inline-flex flex-wrap items-center gap-1 align-middle">
            {oldV && <ValueChip color={categoryColor(a.oldCategory)}>{oldV}</ValueChip>}
            {oldV && <ArrowRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />}
            <ValueChip color={categoryColor(a.newCategory)}>{newV ?? '—'}</ValueChip>
          </span>
        </>
      );
    case 'ASSIGNEE':
      if (newV) {
        return (
          <>
            đã giao cho <span className="font-medium text-ink-strong">{newV}</span>
            {oldV ? <span className="text-muted"> (trước là {oldV})</span> : null}
          </>
        );
      }
      return (
        <>
          đã bỏ giao{oldV ? <span className="text-muted"> (trước là {oldV})</span> : null}
        </>
      );
    case 'PRIORITY':
      return (
        <>
          đã đổi <span className="text-muted">độ ưu tiên</span> {delta(oldV, newV)}
        </>
      );
    case 'STORY_POINTS':
      return (
        <>
          đã đổi <span className="text-muted">điểm</span> {delta(oldV || '0', newV || '0')}
        </>
      );
    case 'SPRINT':
      if (newV) {
        return (
          <>
            đã chuyển vào sprint <span className="font-medium text-ink-strong">{newV}</span>
            {oldV ? <span className="text-muted"> (từ {oldV})</span> : null}
          </>
        );
      }
      return (
        <>
          đã đưa ra khỏi sprint{oldV ? <span className="text-muted"> {oldV}</span> : null}
        </>
      );
    case 'TYPE':
      return (
        <>
          đã đổi <span className="text-muted">loại</span> {delta(oldV, newV)}
        </>
      );
    case 'RESOLUTION':
      return (
        <>
          đã đổi <span className="text-muted">resolution</span> {delta(oldV, newV)}
        </>
      );
    case 'SCOPE':
      return <>đã thay đổi phạm vi</>;
    default:
      return (
        <>
          đã đổi <span className="text-muted">{a.field}</span> {delta(oldV, newV)}
        </>
      );
  }
}

/** Nhãn ngày cho header nhóm: Hôm nay / Hôm qua / d thg M yyyy. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Hôm nay';
  if (isYesterday(d)) return 'Hôm qua';
  return format(d, 'd MMM yyyy', { locale: vi });
}

/** Gộp các mục theo ngày (đã sort desc từ server), giữ thứ tự. */
function groupByDay(items: ProjectActivityItem[]): { key: string; label: string; items: ProjectActivityItem[] }[] {
  const groups: { key: string; label: string; items: ProjectActivityItem[] }[] = [];
  for (const it of items) {
    const key = new Date(it.occurredAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, label: dayLabel(it.occurredAt), items: [it] });
  }
  return groups;
}

/** Một sự kiện trên timeline: chấm + avatar + câu mô tả. */
function TimelineEvent({ a }: { a: ProjectActivityItem }) {
  const Icon = fieldIcon(a.field);
  const abs = format(new Date(a.occurredAt), "HH:mm 'ngày' d MMMM yyyy", { locale: vi });
  const rel = formatDistanceToNow(new Date(a.occurredAt), { addSuffix: true, locale: vi });

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* Nút chấm trên rail: avatar actor, hoặc icon field cho hệ thống */}
      <span className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center">
        {a.actor ? (
          <Avatar name={a.actor.displayName} src={a.actor.avatarUrl} size={28} />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-faint ring-1 ring-border">
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm leading-relaxed text-ink">
          <span className="font-medium text-ink-strong">{a.actor?.displayName ?? 'Hệ thống'}</span>{' '}
          {actionPhrase(a)}{' '}
          <span className="text-muted">·</span>{' '}
          <Link
            to={`/issue/${a.issueKey}`}
            className="font-mono text-[0.8125rem] font-medium text-primary underline-offset-2 hover:underline"
            title={a.issueSummary}
          >
            {a.issueKey}
          </Link>{' '}
          <Link
            to={`/issue/${a.issueKey}`}
            className="text-muted hover:text-ink"
            title={a.issueSummary}
          >
            {a.issueSummary}
          </Link>
        </p>
        <time
          className="mt-0.5 block text-xs text-faint"
          dateTime={a.occurredAt}
          title={abs}
        >
          {rel}
        </time>
      </div>
    </li>
  );
}

export function ProjectActivityPage() {
  const { key = '' } = useParams();
  const { data: project } = useProject(key);
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useProjectActivity(
    project?.id,
  );

  const items = data?.pages.flatMap((p) => p.data) ?? [];
  const groups = groupByDay(items);

  return (
    <div className={pageContainer('sm')}>
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink-strong">
          <History className="h-4 w-4 text-primary" />
          Hoạt động
        </h1>
        <p className="mt-1 text-sm text-muted">Ai đã thao tác gì, trên issue nào.</p>
      </header>

      {isLoading ? (
        <ol className="space-y-5" aria-busy>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex gap-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5 pt-0.5">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-24" />
              </div>
            </li>
          ))}
        </ol>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History className="h-8 w-8" />}
          title="Chưa có hoạt động"
          description="Các thay đổi trên issue của dự án — đổi trạng thái, giao việc, chuyển sprint… — sẽ xuất hiện ở đây theo dòng thời gian."
        />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="sticky top-0 z-[1] -mx-2 mb-3 bg-bg/85 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted backdrop-blur">
                {g.label}
              </h2>
              {/* Rail dọc liên tục + các chấm; rail canh giữa cột avatar (14px = nửa của 28px) */}
              <ol className="relative">
                <span
                  className="pointer-events-none absolute bottom-2 left-[13.5px] top-2 w-px bg-border"
                  aria-hidden
                />
                {g.items.map((a) => (
                  <TimelineEvent key={a.id} a={a} />
                ))}
              </ol>
            </section>
          ))}

          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                size="sm"
                loading={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                Tải thêm
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
