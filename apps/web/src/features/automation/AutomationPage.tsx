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
 * Tự động hoá: mẫu công việc (điền sẵn trường khi tạo) và công việc lặp lại (hệ thống
 * tự sinh việc theo lịch). Chỉ quản trị dự án được tạo/sửa; mọi người đều xem được.
 */
export function AutomationPage() {
  const canManage = useAuth((s) => s.can('project:admin'));
  const [tab, setTab] = useState<Tab>('templates');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'templates', label: 'Mẫu công việc' },
    { id: 'recurring', label: 'Công việc lặp lại' },
  ];

  return (
    <div className={pageContainer('md')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Tự động hoá</h1>
        <p className="mt-1 text-sm text-muted">
          Mẫu công việc giúp bạn khỏi gõ lại những trường quen thuộc. Công việc lặp lại để hệ thống tự tạo việc theo lịch — họp tuần, báo cáo tháng, kiểm tra định kỳ.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-border" role="tablist" aria-label="Loại tự động hoá">
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

/* ---------------------------- Mẫu công việc ---------------------------- */

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
    if (!window.confirm(`Xoá mẫu “${t.name}”? Các việc đã tạo từ mẫu này vẫn giữ nguyên.`)) return;
    try {
      await remove.mutateAsync({ id: t.id, projectId: t.projectId });
      toast.success('Đã xoá mẫu công việc');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-strong">Mẫu công việc</h2>
          <p className="mt-0.5 text-sm text-muted">Điền sẵn loại, độ ưu tiên, tiêu đề và mô tả cho những việc hay gặp.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => edit(null)}>
            <Plus className="h-4 w-4" /> Tạo mẫu
          </Button>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <ListSkeleton />
        ) : !data?.length ? (
          <EmptyState
            icon={<FileStack className="h-6 w-6" />}
            title="Chưa có mẫu công việc nào"
            description="Mẫu điền sẵn loại, độ ưu tiên, tiêu đề và mô tả để bạn tạo việc chỉ trong một bước. Hãy tạo mẫu cho việc hay gặp: báo lỗi, yêu cầu tính năng, đón thành viên mới."
            action={canManage ? <Button size="sm" onClick={() => edit(null)}><Plus className="h-4 w-4" /> Tạo mẫu</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {t.name}
                    <Badge className={t.project ? 'bg-primary-subtle text-primary' : 'bg-surface-2 text-muted'}>
                      {t.project ? t.project.key : 'Dùng chung mọi dự án'}
                    </Badge>
                  </p>
                  {t.description && <p className="mt-0.5 truncate text-xs text-muted">{t.description}</p>}
                  {t.payload.summary && (
                    <p className="mt-0.5 truncate text-xs text-faint" title="Tiêu đề này được điền sẵn khi ai đó tạo việc từ mẫu, vẫn sửa lại được.">
                      Tiêu đề điền sẵn: {t.payload.summary}
                    </p>
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

/* ------------------------- Công việc lặp lại --------------------------- */

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
      toast.success(r.active ? 'Đã tạm dừng lịch lặp' : 'Đã bật lại lịch lặp');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function run(r: RecurringIssue) {
    setRunningId(r.id);
    try {
      const res = await runNow.mutateAsync({ id: r.id, projectId: r.projectId });
      toast.success(`Đã tạo công việc ${res.issue.key}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setRunningId(null);
    }
  }

  async function destroy(r: RecurringIssue) {
    if (!window.confirm(`Xoá lịch “${r.name}”? Các công việc đã tạo trước đó vẫn giữ nguyên.`)) return;
    try {
      await remove.mutateAsync({ id: r.id, projectId: r.projectId });
      toast.success('Đã xoá lịch lặp');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-strong">Công việc lặp lại</h2>
          <p className="mt-0.5 text-sm text-muted">Hệ thống kiểm tra 15 phút một lần và tự tạo công việc khi tới lịch.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => edit(null)}>
            <Plus className="h-4 w-4" /> Tạo lịch lặp
          </Button>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <ListSkeleton />
        ) : !data?.length ? (
          <EmptyState
            icon={<CalendarClock className="h-6 w-6" />}
            title="Chưa có công việc lặp lại nào"
            description="Đặt lịch một lần, hệ thống tự tạo việc mỗi kỳ: họp đầu tuần, báo cáo cuối tháng, rà soát bảo mật."
            action={canManage ? <Button size="sm" onClick={() => edit(null)}><Plus className="h-4 w-4" /> Tạo lịch lặp</Button> : undefined}
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
                      {r.active ? 'Đang chạy' : 'Đang tạm dừng'}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted" title="Lịch chạy của công việc lặp lại này.">{describeRecurrence(r)}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {r.active ? `Lần tạo việc kế tiếp: ${dateTime(r.nextRunAt)}` : 'Đang tạm dừng — hệ thống không tự tạo việc'}
                    {r.lastRunAt ? ` · Lần gần nhất: ${dateTime(r.lastRunAt)}` : ' · Chưa tạo việc nào'}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={runningId === r.id}
                      title="Tạo ngay một công việc từ lịch này. Lần tạo kế tiếp vẫn giữ nguyên."
                      onClick={() => void run(r)}
                    >
                      Tạo việc ngay
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={r.active ? 'Tạm dừng — hệ thống ngừng tự tạo việc' : 'Bật lại — hệ thống tiếp tục tự tạo việc theo lịch'}
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
