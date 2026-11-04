import type { Workflow } from '@/features/workflow-settings/api';

export interface NextStatus {
  id: string;
  name: string;
  category: string;
  /** Thứ tự trạng thái trong workflow — để biết bước đi ngược (xem transitionKind). */
  order: number;
  /** Tên transition do admin đặt (hành động: "Mở lại", "Trả lại"…); null nếu trống. */
  transitionName: string | null;
  /** Nhãn hiển thị trên nút: tên hành động, hoặc tên trạng thái đích khi transition không có tên có nghĩa. */
  label: string;
  /** Gợi ý của máy chủ (rời Pending → trạng thái mở trước khi tạm dừng): nút được nhấn mạnh và đứng đầu. */
  suggested?: boolean;
}

/** Tên hành động của transition, bỏ tên máy sinh kiểu "To <trạng thái đích>" (vd "To To Do"). */
export function transitionLabel(name: string | null | undefined, toStatusName: string): string {
  const n = (name ?? '').trim();
  if (!n) return toStatusName;
  if (n.toLowerCase() === `to ${toStatusName}`.toLowerCase()) return toStatusName;
  return n;
}

/**
 * Quy trình chứa một trạng thái — id trạng thái là duy nhất theo quy trình, nên từ trạng thái hiện tại của MỘT việc suy ra đúng
 * quy trình của loại việc đó (Bug khác Task trong cùng dự án). Chưa tải / không thấy → null.
 */
export function workflowOfStatus(
  workflows: Workflow[] | undefined,
  statusId: string | undefined,
): Workflow | null {
  if (!statusId) return null;
  return (workflows ?? []).find((w) => w.statuses.some((s) => s.id === statusId)) ?? null;
}

const NONE: NextStatus[] = [];

/** Các trạng thái ở BƯỚC KẾ TIẾP — chuyển tiếp hợp lệ từ trạng thái hiện tại theo workflow. */
export function computeNextStatuses(
  workflows: Workflow[] | undefined,
  currentStatusId: string | undefined,
): NextStatus[] {
  if (!currentStatusId) return NONE;
  const wf = (workflows ?? []).find((w) => w.statuses.some((s) => s.id === currentStatusId));
  if (!wf) return NONE;
  const byId = new Map(wf.statuses.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: NextStatus[] = [];
  for (const t of wf.transitions) {
    const applies = t.fromStatusId === currentStatusId || t.fromStatusId == null; // null = "bất kỳ"
    if (!applies || t.toStatusId === currentStatusId || seen.has(t.toStatusId)) continue;
    const s = byId.get(t.toStatusId);
    if (!s) continue;
    seen.add(t.toStatusId);
    out.push({
      id: s.id,
      name: s.name,
      category: s.category,
      order: s.order,
      transitionName: t.name || null,
      label: transitionLabel(t.name, s.name),
    });
  }
  return out;
}

/**
 * Đánh dấu trạng thái được gợi ý (nếu nằm trong các bước kế tiếp) và đưa lên đầu — phím 1 quay lại đúng chỗ trước khi
 * tạm dừng. Không có gợi ý, hoặc gợi ý không còn là bước hợp lệ → giữ nguyên danh sách.
 */
export function withSuggestedFirst(
  next: NextStatus[],
  suggestedStatusId: string | null | undefined,
): NextStatus[] {
  if (!suggestedStatusId) return next;
  const hit = next.find((s) => s.id === suggestedStatusId);
  if (!hit) return next;
  return [{ ...hit, suggested: true }, ...next.filter((s) => s.id !== suggestedStatusId)];
}

/**
 * Bước NGƯỢC (trạng thái mới → trạng thái cũ) có hợp lệ theo workflow không — quyết định toast sau khi chuyển trạng thái
 * có nút "Hoàn tác" hay không (Done → In Review thường không có transition, bấm Hoàn tác sẽ bị 409).
 * Workflow chưa tải / không chứa trạng thái mới → false (không hứa thứ chưa kiểm chứng được).
 */
export function canRevertTransition(
  workflows: Workflow[] | undefined,
  fromStatusId: string,
  toStatusId: string,
): boolean {
  return computeNextStatuses(workflows, toStatusId).some((s) => s.id === fromStatusId);
}
