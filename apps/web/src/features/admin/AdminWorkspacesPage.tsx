import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Search } from 'lucide-react';
import { toast } from 'sonner';
import { pageContainer } from '@/components/layout/page';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Input } from '@/components/ui/Input';
import { QueryError } from '@/components/ui/QueryError';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAdminWorkspaces, usePatchWorkspace, type AdminWorkspace } from './api';
import { fmtInt, relTime } from './_ui';

const PLANS = ['FREE', 'PRO', 'ENTERPRISE'] as const;
const PLAN_STYLE: Record<string, string> = {
  FREE: 'text-muted',
  PRO: 'text-primary',
  ENTERPRISE: 'text-success',
};

export function AdminWorkspacesPage() {
  const { data, isLoading, isError, error, refetch } = useAdminWorkspaces();
  const patch = usePatchWorkspace();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(true);

  const rows = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return (data ?? [])
      .filter((w) => (showArchived ? true : !w.archived))
      .filter((w) => !nq || w.name.toLowerCase().includes(nq) || w.slug.toLowerCase().includes(nq) || w.owner.email.toLowerCase().includes(nq));
  }, [data, q, showArchived]);

  function changePlan(w: AdminWorkspace, plan: (typeof PLANS)[number]) {
    if (plan === w.plan) return;
    patch.mutate({ id: w.id, patch: { plan } }, {
      onSuccess: () => toast.success(`Đã đổi gói ${w.name} → ${plan}`),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  function toggleArchive(w: AdminWorkspace) {
    const next = !w.archived;
    if (next && !window.confirm(`Lưu trữ workspace “${w.name}”? Thành viên sẽ không truy cập được cho đến khi khôi phục.`)) return;
    patch.mutate({ id: w.id, patch: { archived: next } }, {
      onSuccess: () => toast.success(next ? `Đã lưu trữ ${w.name}` : `Đã khôi phục ${w.name}`),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <div className={pageContainer('lg')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Workspaces</h1>
        <p className="mt-1 text-sm text-muted">Mọi workspace trong hệ thống — đổi gói, lưu trữ/khôi phục.</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, slug, email chủ sở hữu…" className="pl-9 text-sm" />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 rounded border-border accent-[var(--primary)]" />
          Hiện đã lưu trữ
        </label>
      </div>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="Không có workspace" description={q ? 'Không khớp bộ lọc.' : 'Chưa có workspace nào.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs text-faint">
                <th className="px-4 py-2.5 font-medium">Workspace</th>
                <th className="px-4 py-2.5 font-medium">Chủ sở hữu</th>
                <th className="px-4 py-2.5 font-medium">Gói</th>
                <th className="px-4 py-2.5 text-right font-medium">TV · Dự án · Issue</th>
                <th className="px-4 py-2.5 font-medium">Hoạt động</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((w) => (
                <tr key={w.id} className={cn('bg-surface transition-colors hover:bg-surface-2/50', w.archived && 'opacity-60')}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-ink">
                      {w.name}
                      {w.archived && <Badge className="text-faint">đã lưu trữ</Badge>}
                    </div>
                    <div className="font-mono text-xs text-faint">/{w.slug}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={w.owner.displayName} src={w.owner.avatarUrl} size={26} />
                      <div className="min-w-0">
                        <div className="truncate text-ink">{w.owner.displayName}</div>
                        <div className="truncate text-xs text-faint">{w.owner.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={w.plan}
                      onChange={(e) => changePlan(w, e.target.value as (typeof PLANS)[number])}
                      disabled={patch.isPending}
                      className={cn('rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:border-primary', PLAN_STYLE[w.plan])}
                    >
                      {PLANS.map((p) => <option key={p} value={p} className="text-ink">{p}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    {fmtInt(w.members)} · {fmtInt(w.projects)} · {fmtInt(w.issues)}
                  </td>
                  <td className="px-4 py-3 text-muted">{relTime(w.lastActivityAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleArchive(w)}
                      disabled={patch.isPending}
                      title={w.archived ? 'Khôi phục' : 'Lưu trữ'}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        w.archived
                          ? 'border-border text-muted hover:bg-surface-2 hover:text-ink'
                          : 'border-transparent text-danger hover:bg-danger/10',
                      )}
                    >
                      {w.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      {w.archived ? 'Khôi phục' : 'Lưu trữ'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
