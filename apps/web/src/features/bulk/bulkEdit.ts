import type { IssueDto } from '@tirapro/types';
import type { BulkIssuePatch } from '@/features/backlog/api';
import { computeNextStatuses, type NextStatus } from '@/features/issues/nextStatuses';
import type { Workflow } from '@/features/workflow-settings/api';

/** Trường mà thanh hàng loạt đổi theo kiểu "đặt một giá trị cho cả lô" (có Hoàn tác bằng giá trị cũ từng việc). */
export type BulkField =
  | 'assigneeId'
  | 'sprintId'
  | 'priorityId'
  | 'storyPoints'
  | 'epicId'
  | 'statusId';
export type BulkValue = string | number | null;
export type VersionedItem = { id: string; version: number };

/** Giá trị HIỆN TẠI của `field` trên việc — để Hoàn tác trả về đúng giá trị cũ của từng việc. */
export function prevValueOf(i: IssueDto, f: BulkField): BulkValue {
  if (f === 'priorityId') return i.priority?.id ?? null;
  if (f === 'statusId') return i.status.id;
  return i[f] ?? null;
}

/** Gom các việc đã cập nhật theo giá trị cũ → mỗi giá trị cũ một request Hoàn tác. */
export function groupByPrev(
  updated: VersionedItem[],
  prev: Map<string, BulkValue>,
): Map<BulkValue, VersionedItem[]> {
  const g = new Map<BulkValue, VersionedItem[]>();
  for (const u of updated) {
    const v = prev.get(u.id) ?? null;
    g.set(v, [...(g.get(v) ?? []), u]);
  }
  return g;
}

/**
 * Các trạng thái mà MỌI việc trong lô đều chuyển tới được (giao các bước kế của từng trạng thái hiện có).
 * Máy chủ kiểm workflow từng hàng và 422 cả lô nếu một hàng không đi được → web chỉ đưa ra lựa chọn hợp lệ cho tất cả.
 */
export function commonNextStatuses(
  workflows: Workflow[] | undefined,
  issues: IssueDto[],
): NextStatus[] {
  const stateIds = [...new Set(issues.map((i) => i.status.id))];
  if (stateIds.length === 0) return [];
  const lists = stateIds.map((id) => computeNextStatuses(workflows, id));
  return lists.reduce((acc, l) => acc.filter((s) => l.some((x) => x.id === s.id)));
}

/**
 * Hoàn tác "Gắn nhãn": chỉ gỡ nhãn khỏi các việc ĐÃ cập nhật mà trước đó CHƯA có nhãn này — không gỡ nhãn
 * người khác đã gắn từ trước. Trả về các việc (kèm version mới) cần `labels.remove`.
 */
export function labelsToUndo(
  before: IssueDto[],
  updated: VersionedItem[],
  labelId: string,
): VersionedItem[] {
  const had = new Set(
    before.filter((i) => (i.labels ?? []).some((l) => l.id === labelId)).map((i) => i.id),
  );
  return updated.filter((u) => !had.has(u.id));
}

/** Một request Hoàn tác: cùng một `patch` cho một nhóm việc (kèm version mới của máy chủ). */
export type UndoPlan = Array<{ items: VersionedItem[]; patch: BulkIssuePatch }>;

/**
 * Kế hoạch Hoàn tác "đặt một giá trị cho cả lô": trả từng việc ĐÃ cập nhật (`updated`, kèm version mới) về giá trị cũ của
 * nó, gom theo giá trị cũ (mỗi giá trị một request). `canRestore` từ chối một giá trị cũ nào đó → `null` (không hứa Hoàn tác).
 */
export function planRestoreField(
  field: BulkField,
  targets: IssueDto[],
  updated: VersionedItem[],
  canRestore?: (prev: BulkValue) => boolean,
): UndoPlan | null {
  const prev = new Map(targets.map((i) => [i.id, prevValueOf(i, field)]));
  const groups = groupByPrev(updated, prev);
  if (canRestore && [...groups.keys()].some((v) => !canRestore(v))) return null;
  return [...groups].map(([value, items]) => ({ items, patch: { [field]: value } }));
}

/** Kết quả một lần gửi nhóm Hoàn tác (phần `useBulkUpdateIssues` trả về mà ta cần). */
interface UndoSendResult {
  conflicts: unknown[];
  unsent: number;
  error?: unknown;
}

/**
 * Chạy lần lượt các nhóm Hoàn tác; cộng dồn số việc CHƯA hoàn tác được (`stuck`: người khác sửa trước hoặc chưa gửi được),
 * số việc chưa gửi (`unsent`) và lỗi đầu tiên (để nêu lý do). Ném lỗi nếu `send` ném (lô đầu của một nhóm bị từ chối).
 */
export async function runUndoPlan(
  plan: UndoPlan,
  send: (items: VersionedItem[], patch: BulkIssuePatch) => Promise<UndoSendResult>,
): Promise<{ stuck: number; unsent: number; firstError: unknown }> {
  let stuck = 0;
  let unsent = 0;
  let firstError: unknown;
  for (const { items, patch } of plan) {
    const r = await send(items, patch);
    stuck += r.conflicts.length;
    unsent += r.unsent;
    firstError ??= r.error;
  }
  return { stuck, unsent, firstError };
}
