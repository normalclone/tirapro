import { useMemo, useState, type ReactNode } from 'react';
import { Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PeoplePicker, type PersonOption } from '@/components/ui/PeoplePicker';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { QueryError } from '@/components/ui/QueryError';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useWorkspaceUsers } from '@/features/members/api';
import { useProjects } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  shortDay,
  useAllocations,
  useCreateAllocation,
  useDeleteAllocation,
  useUpdateAllocation,
  type AllocationDto,
} from './api';

interface FormState {
  id: string | null;
  userId: string;
  projectId: string;
  percent: string;
  startDate: string;
  endDate: string;
  note: string;
}

function emptyForm(projectId: string, from: string, to: string): FormState {
  return { id: null, userId: '', projectId, percent: '100', startDate: from, endDate: to, note: '' };
}

/** Quản lý phân bổ: ai dành bao nhiêu % thời gian cho dự án nào, trong khoảng nào. */
export function AllocationsPanel({
  canManage,
  projectId,
  from,
  to,
}: {
  canManage: boolean;
  projectId: string;
  from: string;
  to: string;
}) {
  const list = useAllocations({ projectId, from, to });
  const { data: users } = useWorkspaceUsers();
  const { data: projects } = useProjects();
  const create = useCreateAllocation();
  const update = useUpdateAllocation();
  const remove = useDeleteAllocation();

  const [form, setForm] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AllocationDto | null>(null);

  const people: PersonOption[] = useMemo(
    () =>
      (users ?? []).map((u) => ({
        id: u.id,
        name: u.displayName,
        avatarUrl: u.avatarUrl,
        email: u.email,
        search: `${u.displayName} ${u.email}`.toLowerCase(),
      })),
    [users],
  );
  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    [projects],
  );

  const saving = create.isPending || update.isPending;

  function startCreate() {
    setForm(emptyForm(projectId, from, to));
  }

  function startEdit(a: AllocationDto) {
    setForm({
      id: a.id,
      userId: a.userId,
      projectId: a.projectId,
      percent: String(a.percent),
      startDate: a.startDate,
      endDate: a.endDate,
      note: a.note ?? '',
    });
  }

  function submit() {
    if (!form) return;
    const percent = Number(form.percent);
    if (!form.userId) return toast.error('Chọn thành viên');
    if (!form.projectId) return toast.error('Chọn dự án');
    if (!Number.isFinite(percent) || percent < 1 || percent > 200) return toast.error('Tỉ lệ phải trong khoảng 1–200%');
    if (!form.startDate || !form.endDate) return toast.error('Chọn khoảng thời gian');
    if (form.endDate < form.startDate) return toast.error('Ngày kết thúc phải sau ngày bắt đầu');

    const payload = {
      userId: form.userId,
      projectId: form.projectId,
      percent: Math.round(percent),
      startDate: form.startDate,
      endDate: form.endDate,
      note: form.note.trim() || null,
    };
    const done = { onSuccess: () => { setForm(null); toast.success(form.id ? 'Đã cập nhật phân bổ' : 'Đã thêm phân bổ'); },
      onError: (e: unknown) => toast.error(apiErrorMessage(e)) };

    if (form.id) update.mutate({ id: form.id, ...payload }, done);
    else create.mutate(payload, done);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => { setPendingDelete(null); toast.success('Đã xoá phân bổ'); },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Phân bổ nguồn lực</h2>
          <p className="mt-0.5 text-sm text-muted">
            Hiển thị các phân bổ giao nhau với khoảng {shortDay(from)} – {shortDay(to)}.
          </p>
        </div>
        {canManage && !form && (
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Thêm phân bổ
          </Button>
        )}
      </div>

      {form && (
        <div className="border-b border-border bg-surface-2/60 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Thành viên" htmlFor="alloc-user">
              <PeoplePicker
                id="alloc-user"
                value={form.userId}
                onChange={(v) => setForm({ ...form, userId: v })}
                options={people}
                includeEmpty={false}
                emptyLabel="Chọn người"
                ariaLabel="Chọn thành viên được phân bổ"
              />
            </Field>
            <Field label="Dự án" htmlFor="alloc-project">
              <SearchSelect
                id="alloc-project"
                value={form.projectId}
                onChange={(v) => setForm({ ...form, projectId: v })}
                options={projectOptions}
                placeholder="Chọn dự án"
                ariaLabel="Chọn dự án"
              />
            </Field>
            <Field label="Tỉ lệ (%)" htmlFor="alloc-percent">
              <Input
                id="alloc-percent"
                type="number"
                min={1}
                max={200}
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
                className="text-sm tabular-nums"
              />
            </Field>
            <Field label="Từ ngày" htmlFor="alloc-start">
              <Input
                id="alloc-start"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="text-sm"
              />
            </Field>
            <Field label="Đến ngày" htmlFor="alloc-end">
              <Input
                id="alloc-end"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="text-sm"
              />
            </Field>
            <Field label="Ghi chú" htmlFor="alloc-note">
              <Input
                id="alloc-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Không bắt buộc"
                className="text-sm"
              />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" loading={saving} onClick={submit}>
              {form.id ? 'Lưu thay đổi' : 'Thêm phân bổ'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Huỷ</Button>
          </div>
        </div>
      )}

      <div className="p-5">
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !list.data || list.data.length === 0 ? (
          <EmptyState
            icon={<SlidersHorizontal className="h-6 w-6" />}
            title="Chưa có phân bổ nào trong khoảng này"
            description={
              canManage
                ? 'Thêm phân bổ để tính đúng năng lực khả dụng. Người chưa phân bổ được tính mặc định 100%.'
                : 'Người chưa có phân bổ được tính mặc định 100% năng lực.'
            }
            action={canManage && !form ? <Button size="sm" onClick={startCreate}><Plus className="h-4 w-4" aria-hidden /> Thêm phân bổ</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th scope="col" className="py-2 pr-3">Thành viên</th>
                  <th scope="col" className="py-2 pr-3">Dự án</th>
                  <th scope="col" className="py-2 pr-3 text-right">Tỉ lệ</th>
                  <th scope="col" className="py-2 pr-3">Khoảng thời gian</th>
                  <th scope="col" className="py-2 pr-3">Ghi chú</th>
                  {canManage && <th scope="col" className="py-2 text-right">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {list.data.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={a.user.displayName} src={a.user.avatarUrl} size={24} />
                        <span className="truncate text-ink">{a.user.displayName}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="text-ink">{a.project.name}</span>
                      <span className="ml-1.5 font-mono text-xs text-faint">{a.project.key}</span>
                    </td>
                    <td className={cn('py-2.5 pr-3 text-right tabular-nums', a.percent > 100 ? 'font-medium text-warning' : 'text-ink')}>
                      {a.percent}%
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-muted">
                      {shortDay(a.startDate)} – {shortDay(a.endDate)}
                    </td>
                    <td className="max-w-[16rem] truncate py-2.5 pr-3 text-muted">{a.note ?? '—'}</td>
                    {canManage && (
                      <td className="py-2.5 text-right">
                        <span className="inline-flex items-center gap-1">
                          <Button variant="ghost" size="icon" title="Sửa" aria-label={`Sửa phân bổ của ${a.user.displayName}`} onClick={() => startEdit(a)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted hover:text-danger"
                            title="Xoá"
                            aria-label={`Xoá phân bổ của ${a.user.displayName}`}
                            onClick={() => setPendingDelete(a)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Xoá phân bổ?"
        description={
          pendingDelete
            ? `${pendingDelete.user.displayName} · ${pendingDelete.project.name} · ${pendingDelete.percent}%. Năng lực của người này sẽ được tính lại.`
            : undefined
        }
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
