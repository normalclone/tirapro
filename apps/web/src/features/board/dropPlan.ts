import type { BoardColumnDto, IssueDto, SwimlaneBy } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import { hintOf, type Placement } from '@/lib/rankDrop';
import { resolveDropStatuses, type DropResolution } from './dropTarget';

export type DropPlan = 'ignore' | 'reorder' | 'status' | 'assign';

/** Khoá làn của việc không có người/ưu tiên/epic/cha. */
export const NO_LANE = '__none__';

/**
 * Quyết định làm gì khi thả thẻ: đổi người (đường cũ) > đổi cột > đổi chỗ trong cột > bỏ qua.
 * Cùng cột nhưng khác container (làn khác) mà không đổi người: làn không phải "người" chỉ là nhóm hiển thị, thẻ không rời
 * làn của nó nên không có chỗ để chèn → bỏ qua (không ghi rank theo thẻ của làn khác).
 */
export function planDrop(a: {
  resKind: DropResolution['kind'];
  assigneeChanged: boolean;
  unchanged: boolean;
  crossContainer?: boolean;
}): DropPlan {
  if (a.assigneeChanged) return 'assign';
  if (a.resKind === 'stay') return a.unchanged || a.crossContainer ? 'ignore' : 'reorder';
  return 'status';
}

export interface DropContext {
  columns: BoardColumnDto[];
  workflows: Workflow[] | undefined;
  swimlaneBy: SwimlaneBy;
  canAssign: boolean;
  /** Người dùng có sửa được việc này không (quyền `issue:edit` hoặc `:own`). */
  canEditIssue: (issue: IssueDto) => boolean;
}

export interface DropDecision {
  plan: DropPlan;
  col: BoardColumnDto;
  res: DropResolution;
  /** Làn "người" đích (null = "Chưa có người phụ trách"); chỉ có nghĩa khi `wantsReassign`. */
  targetAssignee: string | null;
  /** Thả sang hàng người khác của bảng chia theo người. */
  wantsReassign: boolean;
  /** … và được phép đổi người (quyền gán + sửa việc này). */
  assigneeChanged: boolean;
}

/** Container id = "laneKey::colId" (có swimlane) hoặc "colId" (phẳng). */
export function splitContainerId(id: string): { laneKey: string | null; colId: string } {
  const i = id.indexOf('::');
  return i < 0 ? { laneKey: null, colId: id } : { laneKey: id.slice(0, i), colId: id.slice(i + 2) };
}

/**
 * Thuần: thả `issue` vào chỗ `p` thì sẽ làm gì. null = đích không dùng được (cột chưa gắn trạng thái nào / không có cột).
 * Dùng chung cho `onMove` (thực hiện) và phản hồi lúc kéo (đường kẻ, viền, thông báo) để hai bên luôn khớp nhau.
 */
export function decideDrop(issue: IssueDto, p: Placement, ctx: DropContext): DropDecision | null {
  const { laneKey, colId } = splitContainerId(p.containerId);
  const col = ctx.columns.find((c) => c.id === colId);
  if (!col || col.statusIds.length === 0) return null;
  const res = resolveDropStatuses(col, issue.status.id, ctx.workflows);
  // Thả sang làn khác chỉ có nghĩa "đổi người" khi bảng chia làn theo người; các kiểu chia khác chỉ đổi cột.
  const targetAssignee = laneKey === NO_LANE ? null : laneKey;
  const wantsReassign =
    laneKey !== null &&
    ctx.swimlaneBy === 'assignee' &&
    targetAssignee !== (issue.assigneeId ?? null);
  const assigneeChanged = wantsReassign && ctx.canAssign && ctx.canEditIssue(issue);
  const plan = planDrop({
    resKind: res.kind,
    assigneeChanged,
    unchanged: p.unchanged,
    crossContainer: p.crossContainer,
  });
  return { plan, col, res, targetAssignee, wantsReassign, assigneeChanged };
}

/** Phản hồi trực quan lúc kéo theo KẾT QUẢ thả thật: không đổi gì ⇒ không đường kẻ, không viền; đổi người ⇒ không có vị trí. */
export function dropFeedback(
  plan: DropPlan | null,
  p: Placement | null,
): { hint: ReturnType<typeof hintOf>; container: string | null } {
  if (!p || !plan || plan === 'ignore') return { hint: null, container: null };
  return {
    hint: plan === 'assign' ? null : hintOf(p),
    container: p.crossContainer ? p.containerId : null,
  };
}

/** Câu thông báo (aria-live) khi rê/thả — phản ánh đúng kết quả của `plan`. */
export function dropMessage(
  phase: 'over' | 'end',
  a: { key: string; colName: string; plan: DropPlan | null; p: Placement | null },
): string {
  const { key, colName, plan, p } = a;
  if (!p)
    return phase === 'over'
      ? `${key} đang ở ngoài các cột.`
      : `Đã thả ${key} ra ngoài các cột, giữ nguyên.`;
  const at = `vị trí ${p.index + 1}/${p.total}`;
  const end = phase === 'end';
  if (p.unchanged)
    return end
      ? `Đã thả ${key}, giữ nguyên ${at} trong cột “${colName}”.`
      : `${key} ở ${at} trong cột “${colName}”.`;
  if (!plan || plan === 'ignore')
    return end
      ? `Đã thả ${key}, giữ nguyên vị trí.`
      : `${key}: thả ở đây không đổi gì, giữ nguyên vị trí.`;
  if (plan === 'assign')
    return end
      ? `Đã thả ${key} vào hàng khác trong cột “${colName}”, đổi người phụ trách.`
      : `${key} sang hàng khác trong cột “${colName}”, sẽ đổi người phụ trách.`;
  if (p.crossContainer)
    return end
      ? `Đã thả ${key} vào cột “${colName}”, ${at}.`
      : `${key} sang cột “${colName}”, ${at}.`;
  return end
    ? `Đã thả ${key} ở ${at} trong cột “${colName}”.`
    : `${key} ở ${at} trong cột “${colName}”.`;
}
