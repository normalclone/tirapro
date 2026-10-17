import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { IssueDto, PriorityDto, SprintDto } from '@tirapro/types';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useConfirm } from '@/components/ui/useConfirm';
import { usePriorityRanks } from '@/features/settings-admin/api';
import { pointsConfirmOptions, pointsEditWarning } from '@/features/issues/pointsWarning';
import { parsePointsInput } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { TOUCH_HIT } from '@/lib/touchHit';

/** Một mức ưu tiên của dự án (đủ để vẽ chấm + dựng bản vá lạc quan). */
export type PriorityChoice = Pick<PriorityDto, 'id' | 'name' | 'color' | 'rank' | 'isDefault'>;

/**
 * Điều khiển sửa tại chỗ nằm TRONG dòng kéo được: không được bắt đầu kéo, không mở panel xem nhanh.
 * `data-no-peek` + dừng nổi bọt pointer-down (dnd-kit nghe `onPointerDown` ở gốc dòng) / click / phím (dòng nghe Enter/Space).
 */
const stopRowProps = {
  'data-no-peek': true,
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
} as const;

/** Bọc một điều khiển (kể cả nội dung portal của Popover — sự kiện React vẫn nổi qua cây React) khỏi hành vi của dòng. */
function NoRowAction({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span {...stopRowProps} className={className}>
      {children}
    </span>
  );
}

/** Chip điểm tĩnh (hiện ở dòng và ở chế độ chỉ đọc). */
export function PointsChip({ points, title }: { points: number | null; title?: string }) {
  if (points == null) return <span className="text-[11px] text-faint">—</span>;
  return (
    <span
      className="tabular grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-medium text-muted"
      title={title ?? `${points} điểm ước lượng — mức độ lớn của việc này`}
    >
      {points}
    </span>
  );
}

const POINTS_TIP = 'Điểm ước lượng — bấm để đặt lại (Enter lưu, Esc huỷ)';
export const NO_EDIT_TIP = 'Bạn không có quyền sửa công việc này';

/**
 * Chip điểm bấm-để-sửa: bấm → ô số nhỏ; Enter/rời ô = lưu, Esc = huỷ. Việc Done / thuộc sprint đã kết thúc hỏi xác nhận
 * trước khi ghi (B9). `sprints` truyền từ trang (không gọi hook theo dòng — dòng là `memo`, danh sách có thể rất dài).
 */
export function InlinePoints({
  issue,
  canEdit,
  sprints,
  onSave,
  lockedTip,
}: {
  issue: IssueDto;
  canEdit: boolean;
  sprints: SprintDto[] | undefined;
  onSave: (issue: IssueDto, value: number | null) => void;
  /** Giải thích khi không sửa được (bỏ trống = tooltip chip mặc định). */
  lockedTip?: string;
}) {
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();

  async function commit(raw: string) {
    setEditing(false);
    const r = parsePointsInput(raw);
    if (!r.ok) return void toast.error(r.error);
    if (r.value === issue.storyPoints) return;
    const w = pointsEditWarning(issue, sprints);
    if (w && !(await confirm(pointsConfirmOptions(w)))) return;
    onSave(issue, r.value);
  }

  if (!canEdit) {
    return (
      <PointsChip
        points={issue.storyPoints}
        title={
          lockedTip && issue.storyPoints != null
            ? `${issue.storyPoints} điểm ước lượng. ${lockedTip}`
            : undefined
        }
      />
    );
  }
  if (editing) {
    return (
      <input
        {...stopRowProps}
        autoFocus
        type="number"
        min={0}
        max={1000}
        step="any"
        inputMode="decimal"
        defaultValue={issue.storyPoints ?? ''}
        aria-label={`Điểm của ${issue.key}`}
        className="tabular h-6 w-14 rounded border border-primary bg-bg px-1 text-center text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        onBlur={(e) => void commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.preventDefault(); // huỷ ô này thôi — panel xem nhanh/vùng chọn không đóng theo
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      {...stopRowProps}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title={POINTS_TIP}
      aria-label={`Điểm của ${issue.key}: ${issue.storyPoints ?? 'chưa đặt'}. Bấm để sửa`}
      className={cn(
        'grid min-h-5 min-w-6 shrink-0 place-items-center rounded-full px-0.5 transition-colors hover:bg-surface-2',
        TOUCH_HIT,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
      )}
    >
      <PointsChip points={issue.storyPoints} title={POINTS_TIP} />
    </button>
  );
}

/** Mũi tên ưu tiên (tĩnh). */
export function PriorityDot({ priority }: { priority: IssueDto['priority'] }) {
  const ranks = usePriorityRanks();
  if (!priority) {
    return (
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-faint"
        title="Chưa đặt mức ưu tiên"
        role="img"
        aria-label="Chưa đặt mức ưu tiên"
      />
    );
  }
  return (
    <PriorityIcon name={priority.name} rank={priority.rank} ranks={ranks} color={priority.color} />
  );
}

/** Chấm ưu tiên bấm-để-chọn mức (danh sách có ô tìm). Vá lạc quan `priority` bằng đối tượng của dự án. */
export function InlinePriority({
  issue,
  priorities,
  onPick,
}: {
  issue: IssueDto;
  priorities: PriorityChoice[];
  onPick: (issue: IssueDto, priority: PriorityDto | null) => void;
}) {
  const options = useMemo(
    () => [
      { value: '', label: 'Chưa đặt' },
      ...priorities.map((p) => ({ value: p.id, label: p.name, color: p.color })),
    ],
    [priorities],
  );
  // Danh sách của dự án đã có trong scope thì dùng nó; chưa có (meta đang tải) → hạng toàn workspace.
  const workspaceRanks = usePriorityRanks();
  const ranks = useMemo(
    () => (priorities.length > 0 ? priorities.map((p) => p.rank) : workspaceRanks),
    [priorities, workspaceRanks],
  );
  return (
    <NoRowAction className="inline-flex shrink-0">
      <SearchSelect
        ariaLabel={`Ưu tiên của ${issue.key}: ${issue.priority?.name ?? 'chưa đặt'}`}
        value={issue.priority?.id ?? ''}
        options={options}
        hideChevron
        align="start"
        className={cn(
          'h-5 w-5 justify-center rounded-full border-transparent bg-transparent p-0 hover:bg-surface-2',
          TOUCH_HIT,
        )}
        onChange={(v) => {
          if (v === (issue.priority?.id ?? '')) return;
          const p = priorities.find((x) => x.id === v);
          onPick(issue, p ? { ...p, iconKey: null } : null);
        }}
        renderTrigger={() => (
          <span
            className="mx-auto flex items-center justify-center"
            title={
              issue.priority
                ? `Mức ưu tiên: ${issue.priority.name} — bấm để đổi`
                : 'Chưa đặt mức ưu tiên — bấm để chọn'
            }
          >
            {issue.priority ? (
              <PriorityIcon
                name={issue.priority.name}
                rank={issue.priority.rank}
                ranks={ranks}
                color={issue.priority.color}
              />
            ) : (
              <span className="block h-2 w-2 rounded-full bg-faint" aria-hidden />
            )}
          </span>
        )}
      />
    </NoRowAction>
  );
}
