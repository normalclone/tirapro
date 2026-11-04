import { useState } from 'react';
import { ChevronRight, Crown, Users } from 'lucide-react';
import type { TeamDto } from '@tirapro/types';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useTeams } from './api';

/** Nhóm có người dùng này (là thành viên hoặc trưởng nhóm). */
export function teamsOf(teams: TeamDto[], userId: string | undefined): TeamDto[] {
  if (!userId) return [];
  return teams.filter((t) => t.lead?.id === userId || t.members.some((m) => m.id === userId));
}

/**
 * "Nhóm của tôi" — mở từ menu tài khoản: nhóm mình thuộc, bấm một nhóm để xem thành viên.
 * Ai cũng xem được (kể cả người không có quyền quản lý thành viên, vốn không thấy trang Thành viên).
 */
export function MyTeamsPage() {
  const me = useAuth((s) => s.user);
  const teamsQuery = useTeams();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <PageFrame size="sm">
      <PageHeader
        title="Nhóm của tôi"
        description="Các nhóm bạn đang thuộc. Bấm một nhóm để xem thành viên."
      />
      <QueryBoundary
        query={{ ...teamsQuery, data: teamsQuery.data && teamsOf(teamsQuery.data, me?.id) }}
        skeleton={
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        }
        empty={(d) => d.length === 0}
        emptyState={
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Bạn chưa thuộc nhóm nào"
            description="Khi quản trị viên thêm bạn vào một nhóm (ví dụ Nhóm Test), nhóm đó sẽ hiện ở đây."
          />
        }
      >
        {(teams) => (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {teams.map((t) => {
              const expanded = open[t.id] === true;
              const panelId = `team-${t.id}-members`;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpen((s) => ({ ...s, [t.id]: !expanded }))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted transition-transform',
                        expanded && 'rotate-90',
                      )}
                      aria-hidden
                    />
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: t.color ?? 'var(--faint)' }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-strong">
                        {t.name}
                      </span>
                      {t.description && (
                        <span className="block truncate text-xs text-muted">{t.description}</span>
                      )}
                    </span>
                    {t.lead?.id === me?.id && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Crown className="h-3.5 w-3.5" aria-hidden /> Trưởng nhóm
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {t.memberCount} người
                    </span>
                  </button>
                  {expanded && (
                    <ul
                      id={panelId}
                      aria-label={`Thành viên nhóm ${t.name}`}
                      className="space-y-1 px-4 pb-3 pl-11"
                    >
                      {t.members.map((u) => (
                        <li key={u.id} className="flex items-center gap-2.5 py-1">
                          <Avatar name={u.displayName} src={u.avatarUrl} size={24} decorative />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">
                            {u.displayName}
                            {u.id === me?.id && <span className="text-muted"> (bạn)</span>}
                          </span>
                          {t.lead?.id === u.id && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted">
                              <Crown className="h-3.5 w-3.5" aria-hidden /> Trưởng nhóm
                            </span>
                          )}
                          <span className="hidden truncate text-xs text-muted sm:block">
                            {u.email}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryBoundary>
    </PageFrame>
  );
}
