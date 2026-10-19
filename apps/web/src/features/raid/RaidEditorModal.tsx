import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { Badge } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { useRetained } from '@/lib/useRetained';
import { cn } from '@/lib/utils';
import { useProjects } from '@/features/projects/api';
import { useAssigneePicker } from '@/features/issue-edit/useAssigneeOptions';
import {
  useCreateRaidItem,
  useUpdateRaidItem,
  type RaidItemDto,
  type RaidKind,
  type RaidStatus,
} from './api';
import {
  IMPACT_LABELS,
  PROBABILITY_LABELS,
  RAID_KINDS,
  RAID_LEVEL_LEGEND,
  RAID_LEVEL_META,
  RAID_STATUS_OPTIONS,
  SCALE,
  raidLevelOf,
} from './constants';
import { blockOnInvalidDate } from '@/lib/dateGuard';

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

/** Bộ chọn 1..5 dạng nút — mỗi nút có nhãn chữ để không phải đoán ý nghĩa con số. */
function ScalePicker({
  value,
  onChange,
  labels,
  ariaLabel,
  idPrefix,
}: {
  value: number;
  onChange: (v: number) => void;
  labels: Record<number, string>;
  ariaLabel: string;
  idPrefix: string;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={ariaLabel}>
      {SCALE.map((n) => (
        <button
          key={n}
          id={`${idPrefix}-${n}`}
          type="button"
          role="radio"
          aria-checked={value === n}
          title={labels[n]}
          onClick={() => onChange(n)}
          className={cn(
            'h-9 flex-1 rounded-md border text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            value === n
              ? 'border-primary bg-primary text-primary-fg'
              : 'border-border bg-bg text-muted hover:bg-surface-2',
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Modal tạo/sửa một mục trong danh sách rủi ro & vướng mắc. */
export function RaidEditorModal({
  open,
  item: itemProp,
  defaultKind,
  onClose,
}: {
  open: boolean;
  item?: RaidItemDto | null;
  defaultKind?: RaidKind;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  // Chọn người: tìm phía máy chủ (không giới hạn 50 người), loại tài khoản khoá; chủ cũ đã khoá vẫn hiện tên.
  const people = useAssigneePicker();
  const create = useCreateRaidItem();
  const update = useUpdateRaidItem();
  // Cha đặt `item` về null ngay khi đóng → giữ bản lúc mở để tiêu đề/nút không đổi giữa hiệu ứng đóng.
  const item = useRetained(open ? { item: itemProp } : null)?.item;
  const editing = !!item;

  const [kind, setKind] = useState<RaidKind>('RISK');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mitigation, setMitigation] = useState('');
  const [probability, setProbability] = useState(3);
  const [impact, setImpact] = useState(3);
  const [status, setStatus] = useState<RaidStatus>('OPEN');
  const [projectId, setProjectId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    if (!open) return;
    setKind(item?.kind ?? defaultKind ?? 'RISK');
    setTitle(item?.title ?? '');
    setDescription(item?.description ?? '');
    setMitigation(item?.mitigation ?? '');
    setProbability(item?.probability ?? 3);
    setImpact(item?.impact ?? 3);
    setStatus(item?.status ?? 'OPEN');
    setProjectId(item?.projectId ?? '');
    setOwnerId(item?.owner?.id ?? '');
    setDueDate(item?.dueDate ? item.dueDate.slice(0, 10) : '');
  }, [open, item, defaultKind]);

  const projectOptions = useMemo(
    () => [
      { value: '', label: 'Toàn tổ chức' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [projects],
  );

  const busy = create.isPending || update.isPending;
  const canSave = title.trim().length > 0 && !busy;
  const score = probability * impact;
  const level = RAID_LEVEL_META[raidLevelOf(score)];
  const kindMeta = RAID_KINDS.find((k) => k.value === kind);

  async function save() {
    if (!canSave) return;
    if (blockOnInvalidDate()) return;
    const payload = {
      kind,
      title: title.trim(),
      description: description.trim() || null,
      mitigation: mitigation.trim() || null,
      probability,
      impact,
      status,
      projectId: projectId || null,
      ownerId: ownerId || null,
      dueDate: dueDate || null,
    };
    try {
      if (editing && item) {
        await update.mutateAsync({ id: item.id, ...payload });
        toast.success('Đã lưu thay đổi');
      } else {
        await create.mutateAsync(payload);
        toast.success('Đã thêm vào danh sách theo dõi');
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
      title={`${editing ? 'Sửa' : 'Thêm'} ${kindMeta?.label.toLowerCase() ?? 'mục theo dõi'}`}
      size="lg"
      onSubmit={() => void save()}
      footer={
        <>
          <span className="kbd-hint mr-auto text-xs text-faint">Ctrl/Cmd + Enter để lưu</span>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu thay đổi' : `Thêm ${kindMeta?.label.toLowerCase() ?? 'mục'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Loại" hint="(chọn đúng loại để lọc và báo cáo cho chuẩn)">
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label="Loại rủi ro hoặc vướng mắc"
          >
            {RAID_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                title={k.description}
                onClick={() => setKind(k.value)}
                className={cn(
                  'h-8 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  kind === k.value
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'border-border bg-bg text-muted hover:bg-surface-2',
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kindMeta && <p className="mt-1.5 text-xs text-faint">{kindMeta.description}</p>}
        </Field>

        <Field label="Tiêu đề" htmlFor="raid-title">
          <Input
            id="raid-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="VD: Nhà cung cấp giao API chậm hơn cam kết"
            autoFocus
            maxLength={200}
          />
        </Field>

        <Field label="Mô tả" hint="(tùy chọn)" htmlFor="raid-desc">
          <Input
            id="raid-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Bối cảnh, dấu hiệu nhận biết sớm…"
            maxLength={4000}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Xác suất xảy ra"
            hint={`(${probability} — ${PROBABILITY_LABELS[probability]})`}
          >
            <ScalePicker
              value={probability}
              onChange={setProbability}
              labels={PROBABILITY_LABELS}
              ariaLabel="Xác suất xảy ra, từ 1 rất khó tới 5 gần như chắc chắn"
              idPrefix="raid-prob"
            />
          </Field>
          <Field label="Mức ảnh hưởng" hint={`(${impact} — ${IMPACT_LABELS[impact]})`}>
            <ScalePicker
              value={impact}
              onChange={setImpact}
              labels={IMPACT_LABELS}
              ariaLabel="Mức ảnh hưởng nếu xảy ra, từ 1 không đáng kể tới 5 nghiêm trọng"
              idPrefix="raid-impact"
            />
          </Field>
        </div>

        <div
          className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2"
          title={RAID_LEVEL_LEGEND}
        >
          <span className="text-sm text-muted">Điểm rủi ro</span>
          <span className="text-sm font-semibold tabular-nums text-ink-strong">{score}</span>
          <span className="text-xs text-faint">
            = {probability} × {impact}
          </span>
          <Badge className={cn('ml-auto', level.badge)}>{level.label}</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trạng thái" htmlFor="raid-status">
            <SearchSelect
              id="raid-status"
              value={status}
              onChange={(v) => setStatus(v as RaidStatus)}
              options={RAID_STATUS_OPTIONS}
              ariaLabel="Trạng thái"
            />
          </Field>
          <Field label="Hạn xử lý" hint="(tùy chọn — ngày cần xong)" htmlFor="raid-due">
            <DateInput id="raid-due" value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="Dự án" hint="(để trống = ảnh hưởng cả tổ chức)" htmlFor="raid-project">
            <SearchSelect
              id="raid-project"
              value={projectId}
              onChange={setProjectId}
              options={projectOptions}
              ariaLabel="Dự án"
              placeholder="Toàn tổ chức"
              searchPlaceholder="Tìm dự án…"
            />
          </Field>
          <Field
            label="Người phụ trách"
            hint="(tùy chọn — người theo dõi và xử lý)"
            htmlFor="raid-owner"
          >
            <PeoplePicker
              id="raid-owner"
              value={ownerId}
              onChange={setOwnerId}
              {...people}
              emptyLabel="Chưa chọn"
              ariaLabel="Người phụ trách mục này"
            />
          </Field>
        </div>

        <Field
          label="Cách xử lý"
          hint="(tùy chọn — làm gì để bớt nguy hiểm)"
          htmlFor="raid-mitigation"
        >
          <Input
            id="raid-mitigation"
            value={mitigation}
            onChange={(e) => setMitigation(e.target.value)}
            placeholder="Làm gì để giảm xác suất hoặc ảnh hưởng?"
            maxLength={4000}
          />
        </Field>
      </div>
    </Dialog>
  );
}
