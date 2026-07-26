import { useState } from 'react';
import { CalendarClock, FileStack, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { RecurringModal } from './RecurringModal';
import { TemplateModal } from './TemplateModal';
import {
  describeRecurrence, useDeleteRecurring, useDeleteTemplate, useIssueTemplates, useRecurringIssues,
  useRunRecurringNow, useUpdateRecurring, type IssueTemplate, type RecurringIssue,
} from './api';

type Tab = 'templates' | 'recurring';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Tự động hoá: mẫu issue (điền sẵn trường khi tạo) và việc lặp lại (hệ thống tự
 * sinh issue theo lịch). Chỉ quản trị dự án được tạo/sửa; mọi người đều xem được.
 */
export function AutomationPage() {
  const canManage = useAuth((s) => s.can('project:admin'));
  const [tab, setTab] = useState<Tab>('templates');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'templates', label: 'Mẫu issue' },
    { id: 'recurring', label: 'Việc lặp lại' },
  ];

  return (
    <div className={pageContainer('md')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Tự động hoá</h1>
        <p className="mt-1 text-sm text-muted">
          Mẫu issue giúp không phải gõ lại các trường quen thuộc. Việc lặp lại để hệ thống tự tạo issue theo lịch — họp tuần, báo cáo tháng, kiểm tra định kỳ.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-border" role="tablist" aria-label="Tự động hoá">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === t.id ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'templates' ? <TemplatesPanel canManage={canManage} /> : <RecurringPanel canManage={canManage} />}
    </div>
  );
}

/* ------------------------------ Mẫu issue ------------------------------ */

function TemplatesPanel({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useIssueTemplates();
  const remove = useDeleteTemplate();
  const [editing, setEditing] = useState<IssueTemplate | null>(null);
  const [open, setOpen] = useState(false);

  function edit(t: IssueTemplate | null) {
    setEditing(t);
    setOpen(true);
  }

  async function destroy(t: IssueTemplate) {
    if (!window.confirm(`Xoá mẫu “${t.name}”?`)) return;
    try {
      await remove.mutateAsync({ id: t.id, projectId: t.projectId });
      toast.success('Đã xoá mẫu issue');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-strong">Mẫu issue</h2>
          <p className="mt-0.5 text-sm text-muted">Điền sẵn loại, độ ưu tiên, tiêu đề và mô tả cho những việc hay lặp lại.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => edit(null)}>
            <Plus className="h-4 w-4" /> Mẫu mới
          </Button>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <ListSkeleton />
        ) : !data?.length ? (
          <EmptyState
            icon={<FileStack className="h-6 w-6" />}
            title="Chưa có mẫu issue nào"
            description="Tạo mẫu cho những loại việc hay gặp: báo lỗi sản xuất, yêu cầu tính năng, onboarding thành viên…"
            action={canManage ? <Button size="sm" onClick={() => edit(null)}><Plus className="h-4 w-4" /> Mẫu mới</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {t.name}
                    <Badge className={t.project ? 'bg-primary-subtle text-primary' : 'bg-surface-2 text-muted'}>
                      {t.project ? t.project.key : 'Dùng chung'}
                    </Badge>
                  </p>
                  {t.description && <p className="mt-0.5 truncate text-xs text-muted">{t.description}</p>}
                  {t.payload.summary && (
                    <p className="mt-0.5 truncate text-xs text-faint">Tiêu đề mặc định: {t.payload.summary}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" title="Sửa mẫu" aria-label={`Sửa mẫu ${t.name}`} onClick={() => edit(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá mẫu"
                      aria-label={`Xoá mẫu ${t.name}`}
                      onClick={() => void destroy(t)}
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

      <TemplateModal open={open} template={editing} onClose={() => setOpen(false)} />
    </section>
  );
}

/* ---------------------------- Việc lặp lại ----------------------------- */

function RecurringPanel({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useRecurringIssues();
  const update = useUpdateRecurring();
  const remove = useDeleteRecurring();
  const runNow = useRunRecurringNow();
  const [editing, setEditing] = useState<RecurringIssue | null>(null);
  const [open, setOpen] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  function edit(r: RecurringIssue | null) {
    setEditing(r);
    setOpen(true);
  }

  async function toggle(r: RecurringIssue) {
    try {
      await update.mutateAsync({ id: r.id, projectId: r.projectId, active: !r.active });
      toast.success(r.active ? 'Đã tạm dừng việc lặp lại' : 'Đã bật lại việc lặp lại');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function run(r: RecurringIssue) {
    setRunningId(r.id);
    try {
      const res = await runNow.mutateAsync({ id: r.id, projectId: r.projectId });
      toast.success(`Đã tạo issue ${res.issue.key}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setRunningId(null);
    }
  }

  async function destroy(r: RecurringIssue) {
    if (!window.confirm(`Xoá lịch “${r.name}”? Các issue đã tạo vẫn được giữ.`)) return;
    try {
      await remove.mutateAsync({ id: r.id, projectId: r.projectId });
      toast.success('Đã xoá việc lặp lại');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-strong">Việc lặp lại</h2>
          <p className="mt-0.5 text-sm text-muted">Hệ thống kiểm tra mỗi 15 phút và tự tạo issue khi tới lịch.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => edit(null)}>
            <Plus className="h-4 w-4" /> Lịch mới
          </Button>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <ListSkeleton />
        ) : !data?.length ? (
          <EmptyState
            icon={<CalendarClock className="h-6 w-6" />}
            title="Chưa có việc lặp lại nào"
            description="Đặt lịch cho những việc đến hẹn lại lên: họp đầu tuần, báo cáo cuối tháng, rà soát bảo mật."
            action={canManage ? <Button size="sm" onClick={() => edit(null)}><Plus className="h-4 w-4" /> Lịch mới</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {r.name}
                    <Badge className="bg-primary-subtle text-primary">{r.project.key}</Badge>
                    <Badge className={r.active ? 'bg-success/10 text-success' : 'bg-surface-2 text-muted'}>
                      {r.active ? 'Đang bật' : 'Đã tắt'}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{describeRecurrence(r)}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {r.active ? `Lần chạy kế: ${dateTime(r.nextRunAt)}` : 'Đang tạm dừng — không tự chạy'}
                    {r.lastRunAt ? ` · Chạy gần nhất: ${dateTime(r.lastRunAt)}` : ' · Chưa chạy lần nào'}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button size="sm" variant="secondary" loading={runningId === r.id} onClick={() => void run(r)}>
                      Chạy ngay
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={r.active ? 'Tạm dừng' : 'Bật lại'}
                      aria-label={r.active ? `Tạm dừng ${r.name}` : `Bật lại ${r.name}`}
                      onClick={() => void toggle(r)}
                    >
                      {r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" title="Sửa lịch" aria-label={`Sửa lịch ${r.name}`} onClick={() => edit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá lịch"
                      aria-label={`Xoá lịch ${r.name}`}
                      onClick={() => void destroy(r)}
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

      <RecurringModal open={open} item={editing} onClose={() => setOpen(false)} />
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
