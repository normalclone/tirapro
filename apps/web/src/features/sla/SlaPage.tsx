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
  type SlaPolicyDto, SLA_SOON_MINS, SLA_SOON_LABEL } from './api';

/** Bảng theo dõi công việc sắp trễ / đã trễ hạn cam kết (dùng trong mục Quản trị). */
export function SlaBoardPage() {
  return (
    <div className={pageContainer('sm')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Thời gian xử lý</h1>
        <p className="mt-1 text-sm text-muted">
          Các công việc đang chạy đồng hồ đếm ngược theo cam kết thời gian xử lý.
          Việc sắp tới hạn tô vàng, việc đã quá hạn tô đỏ — hãy xử lý từ trên xuống.
        </p>
      </header>
      <SlaBoard />
    </div>
  );
}

/** Cấu hình cam kết thời gian xử lý (dùng trong Cài đặt). */
export function SlaPoliciesPage() {
  const canManage = useAuth((s) => s.can('sla:manage'));
  return (
    <div className={pageContainer('sm')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Cam kết thời gian xử lý</h1>
        <p className="mt-1 text-sm text-muted">
          Đặt thời hạn phải phản hồi và phải xử lý xong cho từng nhóm công việc.
          Hệ thống bấm giờ ngay khi công việc được tạo và cảnh báo khi sắp trễ.
        </p>
      </header>
      <SlaPolicies canManage={canManage} />
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
        title="Chưa có công việc nào đang tính giờ"
        description="Đồng hồ chỉ chạy với công việc khớp một cam kết đang bật. Hãy đặt cam kết thời gian xử lý trong Cài đặt để bắt đầu theo dõi."
      />
    );
  }

  const breached = rows.filter((r) => r.resolveBreached).length;
  const soon = rows.filter((r) => !r.resolveBreached && r.remainingMins <= SLA_SOON_MINS).length;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-ink-strong" title="Đồng hồ chạy từ lúc công việc được tạo cho tới khi xử lý xong.">
          Đang chạy đồng hồ
        </h2>
        <span className="text-sm text-muted">{rows.length} công việc</span>
        {breached > 0 && <Badge className="bg-danger/10 text-danger">{breached} đã quá hạn</Badge>}
        {soon > 0 && <Badge className="bg-warning/15 text-warning">{soon} {SLA_SOON_LABEL}</Badge>}
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const late = r.resolveBreached;
          const soonRow = !late && r.remainingMins <= SLA_SOON_MINS;
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
              <span className="hidden shrink-0 text-xs text-faint md:inline" title="Cam kết thời gian xử lý đang áp dụng cho công việc này.">
                {r.policyName}
              </span>
              {!r.responded && <Badge className="bg-surface-2 text-muted">chưa phản hồi</Badge>}
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                  late ? 'bg-danger/10 text-danger' : soonRow ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-muted',
                )}
                title={
                  late
                    ? `Đã quá hạn xử lý. Hạn là ${new Date(r.resolveDueAt).toLocaleString('vi-VN')}.`
                    : `Thời gian còn lại trước khi phải xử lý xong, hạn là ${new Date(r.resolveDueAt).toLocaleString('vi-VN')}.`
                }
              >
                {late ? <span className="inline-flex items-center gap-1"><TriangleAlert className="h-3 w-3" /> quá hạn {fmtMins(r.remainingMins)}</span> : `còn ${fmtMins(r.remainingMins)}`}
              </span>
              {r.assignee ? (
                <span className="flex shrink-0 items-center gap-1.5" title={`Người xử lý: ${r.assignee.displayName}`}>
                  <Avatar name={r.assignee.displayName} src={r.assignee.avatarUrl} size={20} />
                </span>
              ) : (
                <span className="shrink-0 text-[11px] text-faint" title="Chưa ai nhận việc này — hãy giao người để đồng hồ có chủ.">
                  Chưa giao
                </span>
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
    if (!n) return toast.error('Hãy nhập tên cam kết để dễ nhận ra sau này');
    create.mutate(
      {
        name: n,
        projectId: projectId || null,
        responseMins: Math.max(1, Math.round(Number(responseH) * 60)),
        resolveMins: Math.max(1, Math.round(Number(resolveH) * 60)),
      },
      {
        onSuccess: () => { toast.success('Đã tạo cam kết'); setOpen(false); setName(''); setProjectId(''); },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Danh sách cam kết</h2>
          <p className="mt-0.5 text-sm text-muted">Mỗi cam kết áp cho một dự án cụ thể, hoặc cho mọi dự án nếu bạn không chọn dự án nào.</p>
        </div>
        {canManage && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Thêm cam kết</Button>}
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<AlarmClock className="h-6 w-6" />}
            title="Chưa đặt cam kết nào"
            description={
              canManage
                ? 'Cam kết là thời hạn bạn tự đặt cho việc phản hồi và xử lý xong. Tạo cam kết đầu tiên để hệ thống bắt đầu bấm giờ.'
                : 'Cam kết là thời hạn cho việc phản hồi và xử lý xong. Quản trị viên chưa đặt cam kết nào.'
            }
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
                <span className="shrink-0 text-xs text-muted" title="Tính từ lúc công việc được tạo, phải có phản hồi đầu tiên trong khoảng này.">
                  Phản hồi trong <b className="text-ink">{fmtMins(p.responseMins)}</b>
                </span>
                <span className="shrink-0 text-xs text-muted" title="Tính từ lúc công việc được tạo, phải xử lý xong trong khoảng này.">
                  Xử lý xong trong <b className="text-ink">{fmtMins(p.resolveMins)}</b>
                </span>
                <Badge className={p.active ? 'bg-success/10 text-success' : 'bg-surface-2 text-muted'}>{p.active ? 'Đang áp dụng' : 'Đang tắt'}</Badge>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title={p.active ? 'Ngừng bấm giờ cho công việc mới khớp cam kết này' : 'Bấm giờ trở lại cho công việc mới khớp cam kết này'}
                      aria-label={p.active ? `Tắt cam kết ${p.name}` : `Bật cam kết ${p.name}`}
                      onClick={() => update.mutate({ id: p.id, active: !p.active }, { onError: (e) => toast.error(apiErrorMessage(e)) })}
                    >
                      {p.active ? 'Tắt' : 'Bật'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá cam kết"
                      aria-label={`Xoá cam kết ${p.name}`}
                      onClick={() => { if (window.confirm(`Xoá cam kết “${p.name}”? Các công việc đang tính giờ theo cam kết này sẽ ngừng được theo dõi.`)) remove.mutate(p.id, { onError: (e) => toast.error(apiErrorMessage(e)) }); }}
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
              <span className="text-sm font-medium text-ink">Thêm cam kết thời gian</span>
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setOpen(false)} aria-label="Đóng"><X className="h-4 w-4" /></Button>
            </header>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Tên cam kết</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Hỗ trợ tiêu chuẩn"
                  title="Tên hiện trên bảng theo dõi để bạn biết công việc đang chạy theo cam kết nào."
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Dự án <span className="font-normal text-faint">(để trống = áp cho mọi dự án)</span></label>
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
                  <label className="mb-1.5 block text-sm font-medium text-muted">Phải phản hồi trong (giờ)</label>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={responseH}
                    onChange={(e) => setResponseH(e.target.value)}
                    title="Tính từ lúc công việc được tạo cho tới phản hồi đầu tiên."
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted">Phải xử lý xong trong (giờ)</label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={resolveH}
                    onChange={(e) => setResolveH(e.target.value)}
                    title="Tính từ lúc công việc được tạo cho tới khi chuyển sang trạng thái đã xong."
                  />
                </div>
              </div>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>Huỷ</Button>
              <Button onClick={submit} loading={create.isPending} disabled={!name.trim()}>Tạo cam kết</Button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
