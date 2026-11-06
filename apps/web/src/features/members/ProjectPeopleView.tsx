import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Users } from 'lucide-react';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Input } from '@/components/ui/Input';
import { useProjects } from '@/features/projects/api';
import { useCan } from '@/features/projects/permissions';
import { configSectionPath } from '@/features/project-config/configSections';
import { foldForMatch } from '@tirapro/shared';
import { cn } from '@/lib/utils';
import { useProjectMembers } from './api';

/**
 * Trang Thành viên cho người KHÔNG quản lý thành viên: chỉ xem ai đang ở trong các dự án mình tham gia (mỗi dự án một khối
 * mở/đóng được, kèm vai trò trong dự án). Không thêm/sửa/xoá gì — việc đó dành cho quản trị/PM ở trang đầy đủ.
 */
export function ProjectPeopleView() {
  const { data: projects, isPending } = useProjects();
  const [query, setQuery] = useState('');
  const live = (projects ?? []).filter((p) => !p.archivedAt);

  if (isPending)
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  if (live.length === 0)
    return (
      <EmptyState
        icon={<Users className="h-5 w-5" />}
        title="Bạn chưa tham gia dự án nào"
        description="Khi được thêm vào một dự án, người trong dự án đó sẽ hiện ở đây."
      />
    );
  return (
    <div className="space-y-3" data-tour="members-list">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Tìm người theo tên hoặc email…"
        aria-label="Tìm người trong các dự án"
      />
      <ul className="space-y-2">
        {live.map((p, i) => (
          <ProjectPeople
            key={p.id}
            projectId={p.id}
            name={p.name}
            projectKey={p.key}
            query={query}
            defaultOpen={i === 0}
          />
        ))}
      </ul>
    </div>
  );
}

function ProjectPeople({
  projectId,
  name,
  projectKey,
  query,
  defaultOpen,
}: {
  projectId: string;
  name: string;
  projectKey: string;
  query: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Project Admin của dự án này: có lối tắt tới Cấu hình › Thành viên để thêm/gỡ người và đổi vai trò.
  const canAdmin = useCan(projectId)('project:admin');
  const searching = query.trim() !== '';
  // Đang tìm thì nạp mọi dự án để tìm được người ở dự án đang đóng.
  const { data: members, isPending } = useProjectMembers(open || searching ? projectId : undefined);
  const q = foldForMatch(query.trim());
  const shown = (members ?? []).filter(
    (m) =>
      !q ||
      foldForMatch(m.user.displayName).includes(q) ||
      foldForMatch(m.user.email ?? '').includes(q),
  );
  if (searching && members && shown.length === 0) return null;
  const expanded = open || searching;
  const panelId = `project-people-${projectId}`;

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-faint transition-transform',
              expanded && 'rotate-90',
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-strong">
            {name}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted">{projectKey}</span>
          {members && (
            <span className="tabular shrink-0 text-xs text-muted">{members.length} người</span>
          )}
        </button>
        {canAdmin && (
          <Link
            to={configSectionPath(projectKey, 'members')}
            className="mr-2 inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            title="Thêm người và đổi vai trò trong cấu hình dự án"
            aria-label={`Quản lý thành viên dự án ${name}`}
          >
            Quản lý
          </Link>
        )}
      </div>
      {expanded && (
        <div id={panelId} className="border-t border-border">
          {isPending ? (
            <div className="p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((m) => (
                <li key={m.membershipId} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={m.user.displayName} src={m.user.avatarUrl} size={28} decorative />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{m.user.displayName}</span>
                    {m.user.email && (
                      <span className="block truncate text-xs text-muted">{m.user.email}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {m.roles.map((r) => r.name).join(', ') || '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
