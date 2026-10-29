import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, type IssueDto } from '@tirapro/types';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { apiErrorMessage } from '@/lib/api';
import { labelToneStyle } from '@/lib/labelPalette';
import { cn } from '@/lib/utils';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import { useCreateAndAttachLabel, useProjectLabels, useToggleLabel } from './api';
import {
  CREATE_VALUE,
  createOffer,
  emptyRows,
  labelOptions,
  nextLabelColor,
  pendingAnnouncement,
  pinnedRows,
  reducePending,
  type PendingAction,
  type PendingState,
} from './labelCombo';

const TEMP_PREFIX = 'tmp-label-';
const IDLE: PendingState = { pendingId: null };

/**
 * Trạng thái "chip chờ gỡ" (Backspace lần 1) quanh `reducePending`: ref giữ giá trị mới nhất cho các phím liên tiếp
 * trước khi kịp vẽ lại; tự bỏ đánh dấu khi chip đó biến mất (gỡ xong/lỗi/gỡ từ nơi khác).
 */
function usePendingRemoval(chipIds: readonly string[]) {
  const [pending, setPendingState] = useState<PendingState>(IDLE);
  const ref = useRef(IDLE);
  const set = (p: PendingState) => {
    ref.current = p;
    setPendingState(p);
  };
  const chipKey = chipIds.join(',');
  useEffect(() => {
    const r = reducePending(ref.current, { type: 'chips', chipIds });
    if (r.state !== ref.current) set(r.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khi tập chip đổi
  }, [chipKey]);
  function dispatch(action: PendingAction) {
    const r = reducePending(ref.current, action);
    if (r.state.pendingId !== ref.current.pendingId) set(r.state);
    return r;
  }
  return { pending, dispatch };
}

/**
 * Ô nhãn cho chi tiết issue: chip màu (tông `labelToneStyle`, chữ ≥ 4.5:1 ở cả hai giao diện) có thể gỡ, và nút "+ Nhãn" mở
 * ô chọn có tìm kiếm (dựng trên `SearchSelect`: combobox + listbox + `aria-activedescendant`).
 * - Gõ để lọc; Enter chọn mục đang trỏ (nhãn trùng tên chính xác đứng đầu). KHÔNG bao giờ tạo nhãn trùng tên chỉ khác
 *   hoa/thường/dấu — chọn nhãn có sẵn.
 * - Chưa có nhãn trùng + người dùng có `project:admin` (đúng quyền của trang Nhãn): dòng "Tạo nhãn “X”" ở cuối danh sách (hoặc
 *   Enter khi không còn mục nào khác). Chip hiện NGAY (lạc quan), tên nhãn mới nhận màu chưa dùng đầu tiên của bảng màu chung;
 *   lỗi thì hoàn lại + báo. Không có quyền: dòng gợi ý "Nhờ quản trị dự án tạo nhãn".
 * - Ô tìm trống: Backspace lần 1 đánh dấu chip cuối (viền + báo trình đọc màn hình), lần 2 gỡ nó; phím khác/gõ chữ huỷ đánh dấu.
 */
export function IssueLabelsPicker({ issue, inline }: { issue: IssueDto; inline?: boolean }) {
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const canCreate = useCanIn(issue.projectId)(PERMISSIONS.PROJECT_ADMIN);
  const { data: projectLabels } = useProjectLabels(issue.projectId);
  const { attach, detach } = useToggleLabel(issue.id, issue.key, issue.projectId);
  const createAttach = useCreateAndAttachLabel(issue);

  const [q, setQ] = useState('');
  const removableIds = issue.labels.map((l) => l.id).filter((id) => !id.startsWith(TEMP_PREFIX));
  const { pending, dispatch } = usePendingRemoval(removableIds);

  const labels = projectLabels ?? [];
  const attachedIds = new Set(issue.labels.map((l) => l.id));
  const offer = createOffer({ q, labels, attachedIds, canCreate });
  const options = labelOptions(labels, attachedIds, q);
  const pinned: SearchSelectOption[] = (
    q.trim() === '' ? emptyRows(labels.length, options.length, canCreate) : pinnedRows(offer)
  ).map((o) => (o.value === CREATE_VALUE ? { ...o, icon: <Plus className="h-3.5 w-3.5" /> } : o));

  async function onAttach(labelId: string) {
    try {
      await attach.mutateAsync(labelId);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function onDetach(labelId: string, name: string) {
    try {
      await detach.mutateAsync(labelId);
    } catch (e) {
      toast.error(apiErrorMessage(e));
      return;
    }
    toast.success(`Đã gỡ nhãn "${name}"`);
  }

  function onPick(value: string) {
    if (value !== CREATE_VALUE) {
      void onAttach(value);
      return;
    }
    if (offer.kind !== 'create') return;
    // Lỗi + hoàn lại do `useCreateAndAttachLabel` xử lý ở cấp hook (không mất khi lần gọi bị thay thế/panel unmount).
    createAttach.mutate({ name: offer.name, color: nextLabelColor(labels) });
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLElement>, query: string) {
    const r = dispatch(
      e.key === 'Backspace'
        ? {
            type: 'backspace',
            query,
            chipIds: removableIds,
            repeat: e.repeat,
            busy: detach.isPending,
          }
        : { type: 'key', key: e.key },
    );
    if (r.handled) e.preventDefault();
    if (r.remove) {
      const chip = issue.labels.find((l) => l.id === r.remove);
      if (chip) void onDetach(chip.id, chip.name);
    }
  }

  const pendingName = issue.labels.find((l) => l.id === pending.pendingId)?.name;

  return (
    <div>
      {!inline && <p className="mb-1.5 text-sm font-medium text-muted">Nhãn</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {issue.labels.map((label) => {
          const temp = label.id.startsWith(TEMP_PREFIX);
          const marked = pending.pendingId === label.id;
          return (
            <span
              key={label.id}
              data-pending-removal={marked || undefined}
              aria-busy={temp || undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-full py-0.5 pl-2 text-xs font-medium [@media(pointer:coarse)]:min-h-11',
                canEdit ? 'pr-1' : 'pr-2',
                temp && 'opacity-70',
                // Vòng trung tính (ink) dày + khe hở: vẫn rõ trên chip đỏ/cam (không đỏ-trên-đỏ).
                marked && 'ring-[3px] ring-ink-strong ring-offset-2 ring-offset-bg',
              )}
              style={labelToneStyle(label.color)}
            >
              <span className="max-w-[10rem] truncate">{label.name}</span>
              {canEdit && (
                <button
                  type="button"
                  disabled={temp || detach.isPending}
                  onClick={() => void onDetach(label.id, label.name)}
                  aria-label={`Gỡ nhãn ${label.name}`}
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
                    'hover:bg-[color-mix(in_oklch,currentColor_16%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    // Nút X nhỏ không nền trong chip màu: chỉ cần mờ đi khi tắt (không dùng token vô hiệu — chữ chip có màu riêng).
                    'disabled:opacity-50',
                  )}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          );
        })}

        {canEdit && (
          <SearchSelect
            value=""
            onChange={onPick}
            options={options}
            pinnedOptions={pinned}
            searchable
            ariaLabel="Thêm nhãn"
            searchPlaceholder={canCreate ? 'Tìm hoặc tạo nhãn…' : 'Tìm nhãn…'}
            onSearchChange={(next) => {
              setQ(next);
              dispatch({ type: 'input' });
            }}
            onSearchKeyDown={onSearchKeyDown}
            searchHint={pendingName ? `Nhấn Backspace lần nữa để gỡ “${pendingName}”` : undefined}
            onOpenChange={(o) => {
              if (!o) dispatch({ type: 'close' });
            }}
            hideChevron
            className={cn(
              'h-auto w-auto gap-1 rounded-full border-dashed px-2 py-0.5 text-xs font-medium text-muted',
              'hover:border-primary hover:text-ink [@media(pointer:coarse)]:min-h-11',
            )}
            renderTrigger={() => (
              <span className="inline-flex items-center gap-1">
                <Plus className="h-3 w-3" aria-hidden="true" />
                Nhãn
              </span>
            )}
          />
        )}
        {/* Báo cho trình đọc màn hình chip nào đang chờ gỡ (Backspace lần 2 sẽ gỡ). */}
        <span role="status" className="sr-only">
          {pendingName ? pendingAnnouncement(pendingName) : ''}
        </span>
      </div>
    </div>
  );
}
