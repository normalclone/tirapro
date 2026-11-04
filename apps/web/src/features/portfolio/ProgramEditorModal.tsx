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
import { ColorPicker } from '@/components/ui/ColorPicker';
import { LABEL_PALETTE } from '@/lib/labelPalette';
import { useCreateProgram, useUpdateProgram, type ProgramDto } from './api';
import { toDateInput } from '@/lib/dateFormat';
import { blockOnInvalidDate } from '@/lib/dateGuard';
import { dateRangeError } from '@/lib/dateRange';

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

/** Màu mặc định của nhóm mới (Xanh dương của bảng màu chung). */
const DEFAULT_PROGRAM_COLOR = LABEL_PALETTE[0]!.hex;

/** Ô chọn người phụ trách nhóm (tìm theo tên, tải danh sách khi hộp mở). */
function OwnerField({
  open,
  value,
  onChange,
}: {
  open: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const owners = useUserSelect({ enabled: open });
  const options = useMemo(
    () => [{ value: '', label: 'Chưa chỉ định' }, ...owners.options],
    [owners.options],
  );
  return (
    <Field label="Người phụ trách" hint="(tùy chọn)">
      <SearchSelect
        value={value}
        onChange={onChange}
        options={options}
        onSearchChange={owners.onSearchChange}
        moreHint={owners.moreHint}
        resolveOption={owners.resolveOption}
        placeholder="Chưa chỉ định"
        searchPlaceholder="Tìm thành viên…"
        ariaLabel="Người phụ trách nhóm"
      />
    </Field>
  );
}

interface ProgramForm {
  name: string;
  color: string;
  description: string;
  ownerId: string;
  startDate: string;
  targetDate: string;
  projectIds: string[];
}

/** Thân gửi API từ các ô nhập: chuỗi rỗng → null (xoá trống). */
const programPayload = (f: ProgramForm) => ({
  name: f.name.trim(),
  color: f.color,
  description: f.description.trim() || null,
  ownerId: f.ownerId || null,
  startDate: f.startDate || null,
  targetDate: f.targetDate || null,
  projectIds: f.projectIds,
});

/** Modal tạo/sửa nhóm dự án: tên, màu, người phụ trách, thời hạn và tập dự án. */
export function ProgramEditorModal({
  open,
  program,
  onClose,
}: {
  open: boolean;
  program?: ProgramDto | null;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const create = useCreateProgram();
  const update = useUpdateProgram();
  const editing = !!program;

  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_PROGRAM_COLOR);
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
    setColor(program?.color ?? DEFAULT_PROGRAM_COLOR);
    setDescription(program?.description ?? '');
    setOwnerId(program?.owner?.id ?? '');
    setStartDate(toDateInput(program?.startDate));
    setTargetDate(toDateInput(program?.targetDate));
    setProjectIds(program?.projects.map((p) => p.id) ?? []);
  }, [open, program]);

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
    const payload = programPayload({
      name,
      color,
      description,
      ownerId,
      startDate,
      targetDate,
      projectIds,
    });
    try {
      if (editing && program) {
        await update.mutateAsync({ id: program.id, ...payload });
        toast.success('Đã lưu nhóm');
      } else {
        await create.mutateAsync(payload);
        toast.success('Đã tạo nhóm');
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
      title={editing ? 'Sửa nhóm' : 'Tạo nhóm'}
      icon={<span className="h-3 w-3 rounded-full" style={{ background: color }} />}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu thay đổi' : 'Tạo nhóm'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên nhóm" htmlFor="program-name">
          <Input
            id="program-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Chuyển đổi số"
            autoFocus
            maxLength={120}
          />
        </Field>

        <Field label="Màu nhãn" hint="(để nhận ra nhóm trong danh sách)">
          <ColorPicker value={color} onChange={setColor} ariaLabel="Màu nhãn nhóm" />
        </Field>

        <Field label="Mô tả" hint="(tùy chọn)" htmlFor="program-desc">
          <Input
            id="program-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Nhóm này gom những dự án nào, để làm gì?"
            maxLength={1000}
          />
        </Field>

        <OwnerField open={open} value={ownerId} onChange={setOwnerId} />

        <DateRangeInput
          groupLabel="Thời hạn nhóm"
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

        <Field label="Dự án thuộc nhóm" hint="(bỏ chọn một dự án = tách dự án đó khỏi nhóm)">
          <RoleMultiSelect
            options={projectOptions}
            value={projectIds}
            onChange={setProjectIds}
            requireOne={false}
            placeholder="Chọn dự án…"
            ariaLabel="Chọn dự án thuộc nhóm"
          />
        </Field>
      </div>
    </Dialog>
  );
}
