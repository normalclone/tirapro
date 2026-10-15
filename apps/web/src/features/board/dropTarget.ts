import type { BoardColumnDto } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import { computeNextStatuses, type NextStatus } from '@/features/issues/nextStatuses';

export type DropResolution =
  /** Đã ở trong cột. */
  | { kind: 'stay' }
  /** Cột có status nhưng workflow không cho chuyển tới cái nào. */
  | { kind: 'blocked' }
  /** 1 lựa chọn = chuyển luôn, >1 = hỏi người dùng. */
  | { kind: 'move'; options: NextStatus[] };

/**
 * Thả thẻ vào cột có thể gom nhiều status: chọn các status đích HỢP LỆ theo workflow (giữ thứ tự trong cột).
 * Workflow chưa tải / không chứa status hiện tại → rơi về status đầu của cột để máy chủ kiểm như trước.
 */
export function resolveDropStatuses(
  col: BoardColumnDto,
  currentStatusId: string,
  workflows: Workflow[] | undefined,
): DropResolution {
  if (col.statusIds.includes(currentStatusId)) return { kind: 'stay' };
  const known = (workflows ?? []).some((w) => w.statuses.some((s) => s.id === currentStatusId));
  if (!known) {
    const first = col.statusIds[0];
    // category giả chỉ để thoả kiểu; nơi dùng không đọc category ở nhánh này.
    return first
      ? { kind: 'move', options: [{ id: first, name: col.name, category: 'TODO' }] }
      : { kind: 'blocked' };
  }
  const allowed = new Map(computeNextStatuses(workflows, currentStatusId).map((s) => [s.id, s]));
  const options = col.statusIds.map((id) => allowed.get(id)).filter((s): s is NextStatus => !!s);
  return options.length ? { kind: 'move', options } : { kind: 'blocked' };
}
