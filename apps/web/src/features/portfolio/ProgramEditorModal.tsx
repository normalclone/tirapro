import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { DateRangeInput } from '@/components/ui/DateRangeInput';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useUserSelect } from '@/features/members/useUserSelect';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/utils';
import { useCreateProgram, useUpdateProgram, type ProgramDto } from './api';
import { toDateInput } from '@/lib/dateFormat';
import { blockOnInvalidDate } from '@/lib/dateGuard';
import { dateRangeError } from '@/lib/dateRange';

/** Bảng màu nhãn chương trình — cùng hệ với nhãn nhóm để đọc nhanh trên dòng thời gian. */
const PROGRAM_COLORS = [
  '#2563eb',
  '#16a34a',
  '#a855f7',
  '#f59e0b',
  '#dc2626',
  '#0d9488',
  '#db2777',
  '#6366f1',
];

/** Tên tiếng Việt của từng màu — để tooltip và trình đọc màn hình không đọc mã hex. */
const COLOR_NAMES: Record<string, string> = {
  '#2563eb': 'Xanh dương',
  '#16a34a': 'Xanh lá',
  '#a855f7': 'Tím',
  '#f59e0b': 'Cam',
  '#dc2626': 'Đỏ',
  '#0d9488': 'Xanh ngọc',
  '#db2777': 'Hồng',
  '#6366f1': 'Chàm',
};

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
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
  const owners = useUserSelect({ enabled: open });
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
  // Lỗi hiện có của cặp ngày (chữ sai/ngoài khoảng ở một ô) — DateRangeInput báo lên.
  const [dateErr, setDateErr] = useState('');

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
    () => [{ value: '', label: 'Chưa chỉ định' }, ...owners.options],
    [owners.options],
  );
  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ id: p.id, name: `${p.key} · ${p.name}` })),
    [projects],
  );

  const dateOrderInvalid = dateRangeError(startDate, targetDate) !== null;

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !dateOrderInvalid && !dateErr && !busy;

  async function save() {
    if (!canSave) return;
    if (blockOnInvalidDate()) return;
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={editing ? 'Sửa chương trình' : 'Tạo chương trình'}
      icon={<span className="h-3 w-3 rounded-full" style={{ background: color }} />}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu thay đổi' : 'Tạo chương trình'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên chương trình" htmlFor="program-name">
          <Input
            id="program-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Chuyển đổi số 2026"
            autoFocus
            maxLength={120}
          />
        </Field>

        <Field label="Màu nhãn" hint="(để nhận ra chương trình trên dòng thời gian)">
          <div className="flex flex-wrap gap-2">
            {PROGRAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={COLOR_NAMES[c] ?? 'Màu nhãn'}
                aria-label={`Màu nhãn ${COLOR_NAMES[c] ?? c}`}
                aria-pressed={color === c}
                className={cn(
                  'h-7 w-7 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  color === c
                    ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink-strong'
                    : 'hover:scale-110',
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        <Field label="Mô tả" hint="(tùy chọn)" htmlFor="program-desc">
          <Input
            id="program-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Chương trình này hướng tới điều gì?"
            maxLength={1000}
          />
        </Field>

        <Field label="Người phụ trách" hint="(tùy chọn)">
          <SearchSelect
            value={ownerId}
            onChange={setOwnerId}
            options={ownerOptions}
            onSearchChange={owners.onSearchChange}
            moreHint={owners.moreHint}
            resolveOption={owners.resolveOption}
            placeholder="Chưa chỉ định"
            searchPlaceholder="Tìm thành viên…"
            ariaLabel="Người phụ trách chương trình"
          />
        </Field>

        <DateRangeInput
          groupLabel="Thời hạn chương trình"
          startId="program-start"
          endId="program-target"
          startLabel="Ngày bắt đầu"
          endLabel="Ngày mục tiêu"
          startHint="(tùy chọn)"
          endHint="(tùy chọn — ngày muốn xong)"
          start={startDate}
          end={targetDate}
          onStartChange={setStartDate}
          onEndChange={setTargetDate}
          onErrorChange={setDateErr}
          errorMessage="Ngày mục tiêu đang sớm hơn ngày bắt đầu — hãy sửa lại một trong hai ngày."
        />

        <Field
          label="Dự án thuộc chương trình"
          hint="(bỏ chọn một dự án = tách dự án đó khỏi chương trình)"
        >
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
    </Dialog>
  );
}
