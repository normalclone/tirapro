import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { TeamDto } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useUserSelect } from '@/features/members/useUserSelect';
import { cn } from '@/lib/utils';
import { useCreateTeam, useUpdateTeam } from './api';

/** Bảng màu nhãn nhóm (OKLCH-adjacent, WCAG-friendly trên nền sáng/tối). */
const TEAM_COLORS = [
  '#2563eb',
  '#16a34a',
  '#a855f7',
  '#f59e0b',
  '#dc2626',
  '#0d9488',
  '#db2777',
  '#6366f1',
];

/** Tên màu tiếng Việt cho aria-label (mã hex không đọc lên được cho người dùng trình đọc màn hình). */
const TEAM_COLOR_NAMES: Record<string, string> = {
  '#2563eb': 'xanh dương',
  '#16a34a': 'xanh lá',
  '#a855f7': 'tím',
  '#f59e0b': 'cam',
  '#dc2626': 'đỏ',
  '#0d9488': 'xanh ngọc',
  '#db2777': 'hồng',
  '#6366f1': 'chàm',
};

/** Nhãn + gợi ý cho một ô nhập. `title` = giải nghĩa khi rê chuột vào nhãn. */
function Field({
  label,
  hint,
  title,
  children,
}: {
  label: string;
  hint?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-muted" title={title}>
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Modal tạo/sửa nhóm: tên, màu, mô tả, thành viên & trưởng nhóm. */
export function TeamEditorModal({
  open,
  team,
  onClose,
}: {
  open: boolean;
  team?: TeamDto | null;
  onClose: () => void;
}) {
  const picker = useUserSelect({ enabled: open });
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const editing = !!team;

  const [name, setName] = useState('');
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [description, setDescription] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leadId, setLeadId] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? '');
    setColor(team?.color ?? TEAM_COLORS[0]);
    setDescription(team?.description ?? '');
    setMemberIds(team?.members.map((m) => m.id) ?? []);
    setLeadId(team?.lead?.id ?? '');
  }, [open, team]);

  // Trưởng nhóm chọn trong số thành viên đã chọn (BE tự thêm lead vào nhóm nếu thiếu); tên tra theo id nên người
  // đã khoá / ngoài trang kết quả tìm vẫn hiện.
  const leadOptions = useMemo(
    () => [
      { value: '', label: 'Chưa có trưởng nhóm' },
      ...memberIds.flatMap((id) => {
        const o = picker.resolveOption(id);
        return o ? [{ value: id, label: o.label }] : [];
      }),
    ],
    [picker, memberIds],
  );

  useEffect(() => {
    // Nếu lead bị bỏ khỏi danh sách thành viên thì reset lead.
    if (leadId && !memberIds.includes(leadId)) setLeadId('');
  }, [memberIds, leadId]);

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    const payload = {
      name: name.trim(),
      color,
      description: description.trim() || null,
      leadId: leadId || null,
      memberIds,
    };
    try {
      if (editing && team) {
        await update.mutateAsync({ id: team.id, ...payload });
        toast.success(`Đã lưu nhóm “${payload.name}”`);
      } else {
        await create.mutateAsync(payload);
        toast.success(`Đã tạo nhóm “${payload.name}”`);
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
            {editing ? 'Lưu' : 'Tạo nhóm'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên nhóm" title="Đặt theo chức năng để ai cũng đoán được nhóm làm gì">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Frontend, QA…"
            aria-label="Tên nhóm"
            autoFocus
            maxLength={60}
          />
        </Field>

        <Field label="Màu nhãn" title="Màu này giúp nhận ra nhóm trong các danh sách và bộ lọc">
          <div className="flex flex-wrap gap-2">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Màu ${TEAM_COLOR_NAMES[c] ?? c}`}
                title={`Màu ${TEAM_COLOR_NAMES[c] ?? c}`}
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

        <Field
          label="Mô tả"
          hint="(tùy chọn)"
          title="Một câu để người khác biết nhóm này lo phần nào"
        >
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="VD: Lo giao diện web và ứng dụng di động"
            aria-label="Mô tả nhóm"
            maxLength={500}
          />
        </Field>

        <Field
          label="Thành viên"
          hint="(tùy chọn)"
          title="Chọn những người thuộc nhóm này. Thêm hay bớt lúc nào cũng được."
        >
          <RoleMultiSelect
            options={picker.roleOptions}
            onSearchChange={picker.onSearchChange}
            moreHint={picker.moreHint}
            resolveOption={picker.resolveRole}
            searchPlaceholder="Tìm thành viên…"
            value={memberIds}
            onChange={setMemberIds}
            requireOne={false}
            placeholder="Chọn thành viên…"
            ariaLabel="Chọn thành viên nhóm"
          />
        </Field>

        <Field
          label="Trưởng nhóm"
          hint="(chọn trong thành viên)"
          title="Người đứng đầu nhóm. Chỉ chọn được trong số thành viên đã thêm ở trên."
        >
          <SearchSelect
            value={leadId}
            onChange={setLeadId}
            options={leadOptions}
            placeholder="Chưa có trưởng nhóm"
            searchPlaceholder="Tìm thành viên…"
            ariaLabel="Trưởng nhóm"
          />
        </Field>
      </div>
    </Dialog>
  );
}
