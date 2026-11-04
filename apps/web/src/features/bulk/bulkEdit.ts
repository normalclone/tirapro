import type { IssueDto } from '@tirapro/types';
import type { BulkIssuePatch } from '@/features/backlog/api';
import {
  canRevertTransition,
  computeNextStatuses,
  type NextStatus,
} from '@/features/issues/nextStatuses';
import type { Workflow } from '@/features/workflow-settings/api';

/** Trường mà thanh hàng loạt đổi theo kiểu "đặt một giá trị cho cả lô" (có Hoàn tác bằng giá trị cũ từng việc). */
export type BulkField =
  | 'assigneeId'
  | 'sprintId'
  | 'priorityId'
  | 'storyPoints'
  | 'difficulty'
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
 * Một lựa chọn trong ô "Trạng thái" của thanh hàng loạt. `id` là khoá của lựa chọn (một lô thuần một quy trình: chính id
 * trạng thái). `targets`: việc → trạng thái đích CỦA QUY TRÌNH VIỆC ĐÓ — lô trộn Bug + Task thì cùng tên "Done" là hai trạng
 * thái khác nhau, việc nào không có trong `targets` thì không đổi.
 */
export interface BulkStatusOption extends NextStatus {
  /** Tiêu đề nhóm trong danh sách (chỉ khi lô có nhiều quy trình). */
  group?: string;
  /** Dòng phụ (hiện ở dòng thứ hai): chỉ khi KHÔNG phải mọi việc đều đổi được — bao nhiêu việc sẽ đổi. */
  hint?: string;
  targets: Record<string, string>;
}

/** Tên trạng thái để so khớp "cùng tên" giữa các quy trình (không phân biệt hoa/thường, bỏ khoảng trắng thừa). */
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Lựa chọn trạng thái cho một lô việc có thể thuộc nhiều quy trình (theo loại việc: Bug khác Task).
 * - Cùng một quy trình: như `commonNextStatuses` (bước mà MỌI việc đều đi được).
 * - Nhiều quy trình: trước hết các trạng thái CÙNG TÊN mà ≥ 2 nhóm cùng có ("chỉ những việc có bước chuyển này"), rồi từng
 *   quy trình một với bước chung của riêng nhóm đó. Nhóm không có bước nào thì không hiện.
 * Việc có trạng thái không thuộc quy trình nào đã tải thì không có lựa chọn nào.
 */
export function bulkStatusOptions(
  workflows: Workflow[] | undefined,
  issues: IssueDto[],
): BulkStatusOption[] {
  const flowOf = (statusId: string) =>
    (workflows ?? []).find((w) => w.statuses.some((s) => s.id === statusId));
  const parts = new Map<string, { workflow: Workflow; issues: IssueDto[] }>();
  for (const i of issues) {
    const w = flowOf(i.status.id);
    if (!w) return [];
    const part = parts.get(w.id) ?? { workflow: w, issues: [] };
    part.issues.push(i);
    parts.set(w.id, part);
  }
  const all = [...parts.values()];
  if (all.length === 0) return [];
  if (all.length === 1) {
    const only = all[0]!;
    return commonNextStatuses(workflows, only.issues).map((s) => ({
      ...s,
      targets: Object.fromEntries(only.issues.map((i) => [i.id, s.id])),
    }));
  }
  const perFlow = all.map((p) => ({
    ...p,
    next: commonNextStatuses(workflows, p.issues),
  }));
  const out: BulkStatusOption[] = [];
  // 1) cùng tên ở ≥ 2 quy trình
  const byName = new Map<string, Array<{ part: (typeof perFlow)[number]; status: NextStatus }>>();
  for (const part of perFlow)
    for (const status of part.next) {
      const k = nameKey(status.name);
      byName.set(k, [...(byName.get(k) ?? []), { part, status }]);
    }
  for (const hits of byName.values()) {
    if (hits.length < 2) continue;
    const first = hits[0]!.status;
    const targets: Record<string, string> = {};
    for (const { part, status } of hits) for (const i of part.issues) targets[i.id] = status.id;
    const count = Object.keys(targets).length;
    out.push({
      ...first,
      id: `name:${nameKey(first.name)}`,
      transitionName: null,
      label: first.name,
      group: 'Cùng tên ở nhiều quy trình',
      hint:
        count < issues.length ? `Chỉ ${count}/${issues.length} việc có bước chuyển này` : undefined,
      targets,
    });
  }
  // 2) từng quy trình
  for (const part of perFlow)
    for (const s of part.next)
      out.push({
        ...s,
        id: `${part.workflow.id}:${s.id}`,
        group: `${part.workflow.name} — ${part.issues.length} việc`,
        hint: undefined,
        targets: Object.fromEntries(part.issues.map((i) => [i.id, s.id])),
      });
  return out;
}

/** Các việc của lô gom theo trạng thái đích (mỗi đích một request); chỉ việc nằm trong `option.targets`. */
export function groupByDestination(
  option: BulkStatusOption,
  issues: IssueDto[],
): Array<{ statusId: string; issues: IssueDto[] }> {
  const m = new Map<string, IssueDto[]>();
  for (const i of issues) {
    const dest = option.targets[i.id];
    if (dest) m.set(dest, [...(m.get(dest) ?? []), i]);
  }
  return [...m].map(([statusId, list]) => ({ statusId, issues: list }));
}

/**
 * Hoàn tác "Đổi trạng thái" cho lô nhiều đích: từng nhóm đích trả về trạng thái cũ của nó, và chỉ hứa Hoàn tác khi quy
 * trình cho phép bước ngược ở MỌI nhóm (không thì bấm Hoàn tác sẽ bị máy chủ từ chối). Không nhóm nào → `null`.
 */
export function statusUndoPlan(
  workflows: Workflow[] | undefined,
  option: BulkStatusOption,
  targets: IssueDto[],
  updated: VersionedItem[],
): UndoPlan | null {
  const plan: UndoPlan = [];
  for (const g of groupByDestination(option, targets)) {
    const ids = new Set(g.issues.map((i) => i.id));
    const part = planRestoreField(
      'statusId',
      g.issues,
      updated.filter((u) => ids.has(u.id)),
      (prev) =>
        typeof prev === 'string' ? canRevertTransition(workflows, prev, g.statusId) : false,
    );
    if (part === null) return null;
    plan.push(...part);
  }
  return plan.length > 0 ? plan : null;
}

/** Một lần gửi bulk: các việc (đích chung) + `patch`. */
export interface BulkPart {
  issues: IssueDto[];
  patch: BulkIssuePatch;
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

/** Kết quả một lần bulk (phần cần để quyết định lựa chọn kế tiếp). */
export interface BulkOutcome {
  /** `all` = xong hết · `partial` = một phần (còn việc chưa xong) · `none` = không việc nào xong. */
  kind: 'all' | 'partial' | 'none';
  updatedCount: number;
  conflictCount: number;
}

/**
 * Sau một lần bulk: bỏ chọn các việc ĐÃ xong, GIỮ chọn các việc chưa xong (conflict: người khác sửa trước, hoặc chưa gửi được)
 * để người dùng thử lại ngay. `retain` chỉ gồm id vẫn thuộc lựa chọn hiện tại. Hoàn tác (nếu có) chỉ áp cho phần đã xong.
 */
export function planBulkResult(
  result: { updated: Array<{ id: string }>; conflicts: Array<{ id: string }> },
  selected: ReadonlySet<string>,
): BulkOutcome & { retain: ReadonlySet<string> } {
  const retain = new Set(result.conflicts.map((c) => c.id).filter((id) => selected.has(id)));
  const updatedCount = result.updated.length;
  const conflictCount = result.conflicts.length;
  const kind = conflictCount === 0 ? 'all' : updatedCount === 0 ? 'none' : 'partial';
  return { kind, updatedCount, conflictCount, retain };
}

/** Dòng chính của toast tổng kết một lần bulk. */
export function bulkResultTitle(verb: string, o: BulkOutcome): string {
  if (o.kind === 'all') return `Đã ${verb} ${o.updatedCount} việc.`;
  if (o.kind === 'partial')
    return `Đã cập nhật ${o.updatedCount} việc · ${o.conflictCount} việc chưa cập nhật được`;
  return `Chưa cập nhật được việc nào (${o.conflictCount} việc)`;
}
