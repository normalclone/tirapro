import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useWorkspaceUsers } from '@/features/members/api';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/utils';
import { useCreateProgram, useUpdateProgram, type ProgramDto } from './api';

/** Bảng màu nhãn chương trình — cùng hệ với nhãn nhóm để đọc nhanh trên roadmap. */
const PROGRAM_COLORS = ['#2563eb', '#16a34a', '#a855f7', '#f59e0b', '#dc2626', '#0d9488', '#db2777', '#6366f1'];

/** ISO → 'YYYY-MM-DD' cho input type=date (rỗng nếu không có). */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Modal tạo/sửa chương trình: tên, màu, người phụ trách, thời hạn và tập dự án. */
export function ProgramEditorModal({
  open,
  program,
  onClose,
}: {
  open: boolean;
  program?: ProgramDto | null;
  onClose: () => void;
}) {
  const { data: users } = useWorkspaceUsers();
  const { data: projects } = useProjects();
  const create = useCreateProgram();
  const update = useUpdateProgram();
  const editing = !!program;

  const [name, setName] = useState('');
  const [color, setColor] = useState(PROGRAM_COLORS[0]);
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(program?.name ?? '');
    setColor(program?.color ?? PROGRAM_COLORS[0]);
    setDescription(program?.description ?? '');
    setOwnerId(program?.owner?.id ?? '');
    setStartDate(toDateInput(program?.startDate));
    setTargetDate(toDateInput(program?.targetDate));
    setProjectIds(program?.projects.map((p) => p.id) ?? []);
  }, [open, program]);

  const ownerOptions = useMemo(
    () => [{ value: '', label: 'Chưa chỉ định' }, ...(users ?? []).map((u) => ({ value: u.id, label: u.displayName }))],
    [users],
  );
  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ id: p.id, name: `${p.key} · ${p.name}` })),
    [projects],
  );

  const dateOrderInvalid = !!startDate && !!targetDate && startDate > targetDate;

  if (!open) return null;

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !dateOrderInvalid && !busy;

  async function save() {
    if (!canSave) return;
    const payload = {
      name: name.trim(),
      color,
      description: description.trim() || null,
      ownerId: ownerId || null,
      startDate: startDate || null,
      targetDate: targetDate || null,
      projectIds,
    };
    try {
      if (editing && program) {
        await update.mutateAsync({ id: program.id, ...payload });
        toast.success('Đã lưu chương trình');
      } else {
        await create.mutateAsync(payload);
        toast.success('Đã tạo chương trình');
      }
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Sửa chương trình' : 'Tạo chương trình'}
        className="relative flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="text-sm font-medium text-ink">{editing ? 'Sửa chương trình' : 'Tạo chương trình'}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <Field label="Tên chương trình" htmlFor="program-name">
            <Input id="program-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Chuyển đổi số 2026" autoFocus maxLength={120} />
          </Field>

          <Field label="Màu">
            <div className="flex flex-wrap gap-2">
              {PROGRAM_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Màu ${c}`}
                  aria-pressed={color === c}
                  className={cn(
                    'h-7 w-7 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink-strong' : 'hover:scale-110',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>

          <Field label="Mô tả" hint="(tùy chọn)" htmlFor="program-desc">
            <Input id="program-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Chương trình này hướng tới điều gì?" maxLength={1000} />
          </Field>

          <Field label="Người phụ trách" hint="(tùy chọn)">
            <SearchSelect
              value={ownerId}
              onChange={setOwnerId}
              options={ownerOptions}
              placeholder="Chưa chỉ định"
              searchPlaceholder="Tìm thành viên…"
              ariaLabel="Người phụ trách chương trình"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ngày bắt đầu" hint="(tùy chọn)" htmlFor="program-start">
              <Input id="program-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Ngày mục tiêu" hint="(tùy chọn)" htmlFor="program-target">
              <Input id="program-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
          </div>
          {dateOrderInvalid && (
            <p className="text-xs text-danger" role="alert">Ngày mục tiêu phải sau ngày bắt đầu.</p>
          )}

          <Field label="Dự án thuộc chương trình" hint="(gỡ khỏi danh sách = tách khỏi chương trình)">
            <RoleMultiSelect
              options={projectOptions}
              value={projectIds}
              onChange={setProjectIds}
              requireOne={false}
              placeholder="Chọn dự án…"
              ariaLabel="Chọn dự án thuộc chương trình"
            />
          </Field>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>{editing ? 'Lưu' : 'Tạo chương trình'}</Button>
        </footer>
      </div>
    </div>
  );
}
