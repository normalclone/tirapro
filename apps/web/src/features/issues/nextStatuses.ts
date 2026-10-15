import type { Workflow } from '@/features/workflow-settings/api';

export interface NextStatus {
  id: string;
  name: string;
  category: string;
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
    out.push({ id: s.id, name: s.name, category: s.category });
  }
  return out;
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
