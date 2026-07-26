import { useMemo, useState, type ReactNode } from 'react';
import { CalendarOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PeoplePicker, type PersonOption } from '@/components/ui/PeoplePicker';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { QueryError } from '@/components/ui/QueryError';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { useWorkspaceUsers } from '@/features/members/api';
import { apiErrorMessage } from '@/lib/api';
import {
  shortDay,
  useCreateTimeOff,
  useDeleteTimeOff,
  useTimeOffs,
  useUpdateTimeOff,
  type TimeOffDto,
  type TimeOffKind,
} from './api';

const KIND_META: Record<TimeOffKind, { label: string; className: string }> = {
  LEAVE: { label: 'Nghỉ phép', className: 'bg-primary-subtle text-primary' },
  HOLIDAY: { label: 'Ngày lễ', className: 'bg-success/10 text-success' },
  OTHER: { label: 'Khác', className: 'bg-surface-2 text-muted' },
};

const KIND_OPTIONS = (Object.keys(KIND_META) as TimeOffKind[]).map((k) => ({ value: k, label: KIND_META[k].label }));

interface FormState {
  id: string | null;
  scope: 'workspace' | 'person';
  userId: string;
  kind: TimeOffKind;
  startDate: string;
  endDate: string;
  note: string;
}

function emptyForm(from: string, to: string): FormState {
  return { id: null, scope: 'person', userId: '', kind: 'LEAVE', startDate: from, endDate: from <= to ? from : to, note: '' };
}

/** Nghỉ phép cá nhân và ngày lễ chung — trừ thẳng vào số giờ làm được của mỗi người. */
export function TimeOffPanel({ canManage, from, to }: { canManage: boolean; from: string; to: string }) {
  const list = useTimeOffs({ from, to });
  const { data: users } = useWorkspaceUsers();
  const create = useCreateTimeOff();
  const update = useUpdateTimeOff();
  const remove = useDeleteTimeOff();

  const [form, setForm] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimeOffDto | null>(null);

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

  const saving = create.isPending || update.isPending;

  function startEdit(t: TimeOffDto) {
    setForm({
      id: t.id,
      scope: t.userId ? 'person' : 'workspace',
      userId: t.userId ?? '',
      kind: t.kind,
      startDate: t.startDate,
      endDate: t.endDate,
      note: t.note ?? '',
    });
  }

  function submit() {
    if (!form) return;
    if (form.scope === 'person' && !form.userId) return toast.error('Hãy chọn người nghỉ, hoặc đổi phạm vi sang “Cả tổ chức”');
    if (!form.startDate || !form.endDate) return toast.error('Hãy chọn cả ngày bắt đầu và ngày kết thúc');
    if (form.endDate < form.startDate) return toast.error('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu');

    const payload = {
      userId: form.scope === 'workspace' ? null : form.userId,
      kind: form.kind,
      startDate: form.startDate,
      endDate: form.endDate,
      note: form.note.trim() || null,
    };
    const done = {
      onSuccess: () => { setForm(null); toast.success(form.id ? 'Đã cập nhật ngày nghỉ' : 'Đã thêm ngày nghỉ'); },
      onError: (e: unknown) => toast.error(apiErrorMessage(e)),
    };
    if (form.id) update.mutate({ id: form.id, ...payload }, done);
    else create.mutate(payload, done);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => { setPendingDelete(null); toast.success('Đã xoá ngày nghỉ'); },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Nghỉ phép & ngày lễ</h2>
          <p className="mt-0.5 text-sm text-muted">
            Ngày nghỉ được trừ thẳng khỏi số giờ làm được, nên bảng khối lượng không tính nhầm.
            Đang hiện khoảng {shortDay(from)} – {shortDay(to)}.
          </p>
        </div>
        {canManage && !form && (
          <Button size="sm" onClick={() => setForm(emptyForm(from, to))}>
            <Plus className="h-4 w-4" aria-hidden /> Thêm ngày nghỉ
          </Button>
        )}
      </div>

      {form && (
        <div className="border-b border-border bg-surface-2/60 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Phạm vi" htmlFor="off-scope">
              <SearchSelect
                id="off-scope"
                value={form.scope}
                onChange={(v) => setForm({ ...form, scope: v as FormState['scope'], kind: v === 'workspace' ? 'HOLIDAY' : form.kind })}
                options={[
                  { value: 'person', label: 'Một thành viên nghỉ' },
                  { value: 'workspace', label: 'Cả tổ chức nghỉ — ngày lễ chung' },
                ]}
                ariaLabel="Phạm vi áp dụng"
              />
            </Field>
            {form.scope === 'person' && (
              <Field label="Thành viên" htmlFor="off-user">
                <PeoplePicker
                  id="off-user"
                  value={form.userId}
                  onChange={(v) => setForm({ ...form, userId: v })}
                  options={people}
                  includeEmpty={false}
                  emptyLabel="Chọn người"
                  ariaLabel="Chọn thành viên nghỉ"
                />
              </Field>
            )}
            <Field label="Loại" htmlFor="off-kind">
              <SearchSelect
                id="off-kind"
                value={form.kind}
                onChange={(v) => setForm({ ...form, kind: v as TimeOffKind })}
                options={KIND_OPTIONS}
                ariaLabel="Loại nghỉ"
              />
            </Field>
            <Field label="Từ ngày" htmlFor="off-start">
              <Input id="off-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="text-sm" />
            </Field>
            <Field label="Đến ngày" htmlFor="off-end">
              <Input id="off-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="text-sm" />
            </Field>
            <Field label="Ghi chú" htmlFor="off-note">
              <Input id="off-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ví dụ: nghỉ cưới" className="text-sm" />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" loading={saving} onClick={submit}>{form.id ? 'Lưu thay đổi' : 'Thêm ngày nghỉ'}</Button>
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
            icon={<CalendarOff className="h-6 w-6" />}
            title="Không có ngày nghỉ nào trong khoảng này"
            description="Nghỉ phép và ngày lễ được trừ khỏi số giờ làm được. Khai báo ngay để bảng khối lượng không tính nhầm."
            action={canManage && !form ? <Button size="sm" onClick={() => setForm(emptyForm(from, to))}><Plus className="h-4 w-4" aria-hidden /> Thêm ngày nghỉ</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                {t.user ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Avatar name={t.user.displayName} src={t.user.avatarUrl} size={26} />
                    <span className="truncate text-sm text-ink">{t.user.displayName}</span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 text-sm text-ink" title="Ngày lễ chung — trừ số giờ làm được của tất cả thành viên.">
                    Cả tổ chức
                  </span>
                )}

                <Badge className={KIND_META[t.kind].className}>{KIND_META[t.kind].label}</Badge>

                <span className="whitespace-nowrap text-sm tabular-nums text-muted">
                  {shortDay(t.startDate)} – {shortDay(t.endDate)}
                </span>

                <span className="max-w-[14rem] truncate text-sm text-faint">{t.note ?? ''}</span>

                {canManage && (
                  <span className="ml-auto inline-flex items-center gap-1">
                    <Button variant="ghost" size="icon" title="Sửa" aria-label="Sửa ngày nghỉ" onClick={() => startEdit(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá"
                      aria-label="Xoá ngày nghỉ"
                      onClick={() => setPendingDelete(t)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Xoá ngày nghỉ?"
        description={
          pendingDelete
            ? `${pendingDelete.user?.displayName ?? 'Cả tổ chức'} · ${shortDay(pendingDelete.startDate)} – ${shortDay(pendingDelete.endDate)}. Số giờ làm được sẽ được tính lại ngay.`
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
