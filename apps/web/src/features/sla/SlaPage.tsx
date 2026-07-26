import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { pageContainer } from '@/components/layout/page';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useAuth } from '@/stores/auth';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/utils';
import {
  useSlaBoard, useSlaPolicies, useCreateSlaPolicy, useUpdateSlaPolicy, useDeleteSlaPolicy, fmtMins,
  type SlaPolicyDto,
} from './api';

type Tab = 'board' | 'policies';

/** Service desk: theo dõi ticket theo SLA + cấu hình chính sách. */
export function SlaPage() {
  const canManage = useAuth((s) => s.can('sla:manage'));
  const [tab, setTab] = useState<Tab>('board');

  return (
    <div className={pageContainer('sm')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">SLA &amp; Service desk</h1>
        <p className="mt-1 text-sm text-muted">
          Cam kết thời gian phản hồi và giải quyết cho từng loại yêu cầu. Hạn được gắn tự động khi tạo issue.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-border" role="tablist" aria-label="SLA">
        {([['board', 'Đang theo dõi'], ['policies', 'Chính sách']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === id ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'board' ? <SlaBoard /> : <SlaPolicies canManage={canManage} />}
    </div>
  );
}

function SlaBoard() {
  const { data, isLoading } = useSlaBoard();
  const rows = data ?? [];

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<AlarmClock className="h-6 w-6" />}
        title="Không có ticket nào đang chạy SLA"
        description="Issue mới tạo sẽ tự gắn SLA nếu khớp một chính sách đang bật."
      />
    );
  }

  const breached = rows.filter((r) => r.resolveBreached).length;
  const soon = rows.filter((r) => !r.resolveBreached && r.remainingMins <= 120).length;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-ink-strong">Đang theo dõi</h2>
        <span className="text-sm text-muted">{rows.length} ticket</span>
        {breached > 0 && <Badge className="bg-danger/10 text-danger">{breached} vi phạm</Badge>}
        {soon > 0 && <Badge className="bg-warning/15 text-warning">{soon} sắp trễ</Badge>}
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const late = r.resolveBreached;
          const soonRow = !late && r.remainingMins <= 120;
          return (
            <li key={r.issueId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
              <Link to={`/issue/${r.key}`} className="shrink-0 font-mono text-xs text-primary hover:underline">{r.key}</Link>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.summary}</span>
              {r.priority && (
                <span className="hidden shrink-0 items-center gap-1 text-xs text-muted sm:flex">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.priority.color ?? 'var(--faint)' }} />
                  {r.priority.name}
                </span>
              )}
              <span className="hidden shrink-0 text-xs text-faint md:inline">{r.policyName}</span>
              {!r.responded && <Badge className="bg-surface-2 text-muted">chưa phản hồi</Badge>}
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                  late ? 'bg-danger/10 text-danger' : soonRow ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-muted',
                )}
                title={`Hạn: ${new Date(r.resolveDueAt).toLocaleString('vi-VN')}`}
              >
                {late ? <span className="inline-flex items-center gap-1"><TriangleAlert className="h-3 w-3" /> trễ {fmtMins(r.remainingMins)}</span> : `còn ${fmtMins(r.remainingMins)}`}
              </span>
              {r.assignee ? (
                <span className="flex shrink-0 items-center gap-1.5" title={r.assignee.displayName}>
                  <Avatar name={r.assignee.displayName} src={r.assignee.avatarUrl} size={20} />
                </span>
              ) : (
                <span className="shrink-0 text-[11px] text-faint">Chưa gán</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SlaPolicies({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useSlaPolicies();
  const { data: projects } = useProjects();
  const create = useCreateSlaPolicy();
  const update = useUpdateSlaPolicy();
  const remove = useDeleteSlaPolicy();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [responseH, setResponseH] = useState('4');
  const [resolveH, setResolveH] = useState('24');

  const list = data ?? [];

  function submit() {
    const n = name.trim();
    if (!n) return toast.error('Nhập tên chính sách');
    create.mutate(
      {
        name: n,
        projectId: projectId || null,
        responseMins: Math.max(1, Math.round(Number(responseH) * 60)),
        resolveMins: Math.max(1, Math.round(Number(resolveH) * 60)),
      },
      {
        onSuccess: () => { toast.success('Đã tạo chính sách'); setOpen(false); setName(''); setProjectId(''); },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Chính sách SLA</h2>
          <p className="mt-0.5 text-sm text-muted">Áp theo dự án; để trống dự án nghĩa là áp cho toàn workspace.</p>
        </div>
        {canManage && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Thêm chính sách</Button>}
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<AlarmClock className="h-6 w-6" />}
            title="Chưa có chính sách SLA"
            description={canManage ? 'Tạo chính sách đầu tiên để bắt đầu đo thời gian phản hồi/giải quyết.' : 'Quản trị chưa cấu hình SLA.'}
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((p: SlaPolicyDto) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-strong">{p.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {p.project ? `Dự án ${p.project.key}` : 'Mọi dự án'}
                    {p.priority ? ` · ${p.priority.name}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">Phản hồi <b className="text-ink">{fmtMins(p.responseMins)}</b></span>
                <span className="shrink-0 text-xs text-muted">Giải quyết <b className="text-ink">{fmtMins(p.resolveMins)}</b></span>
                <Badge className={p.active ? 'bg-success/10 text-success' : 'bg-surface-2 text-muted'}>{p.active ? 'Đang bật' : 'Tắt'}</Badge>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => update.mutate({ id: p.id, active: !p.active }, { onError: (e) => toast.error(apiErrorMessage(e)) })}
                    >
                      {p.active ? 'Tắt' : 'Bật'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      aria-label={`Xoá ${p.name}`}
                      onClick={() => { if (window.confirm(`Xoá chính sách “${p.name}”?`)) remove.mutate(p.id, { onError: (e) => toast.error(apiErrorMessage(e)) }); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[10vh]">
          <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={() => setOpen(false)} aria-label="Đóng" />
          <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
            <header className="flex items-center gap-2 border-b border-border px-5 py-3">
              <span className="text-sm font-medium text-ink">Thêm chính sách SLA</span>
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setOpen(false)} aria-label="Đóng"><X className="h-4 w-4" /></Button>
            </header>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Tên chính sách</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Hỗ trợ tiêu chuẩn" autoFocus />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Dự án <span className="font-normal text-faint">(trống = mọi dự án)</span></label>
                <SearchSelect
                  value={projectId}
                  onChange={setProjectId}
                  options={[{ value: '', label: 'Mọi dự án' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key }))]}
                  placeholder="Mọi dự án"
                  searchPlaceholder="Tìm dự án…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted">Hạn phản hồi (giờ)</label>
                  <Input type="number" min={0.5} step={0.5} value={responseH} onChange={(e) => setResponseH(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted">Hạn giải quyết (giờ)</label>
                  <Input type="number" min={1} step={1} value={resolveH} onChange={(e) => setResolveH(e.target.value)} />
                </div>
              </div>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>Hủy</Button>
              <Button onClick={submit} loading={create.isPending} disabled={!name.trim()}>Tạo</Button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
