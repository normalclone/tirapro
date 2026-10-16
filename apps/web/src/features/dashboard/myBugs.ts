import type { Workflow } from '@/features/workflow-settings/api';

/**
 * Trạng thái "chờ xác nhận" = bước CUỐI trước Done: trạng thái nhóm IN_PROGRESS có `order` lớn nhất của workflow,
 * và CHỈ khi workflow có ≥ 2 trạng thái IN_PROGRESS (Scrum: In Review). Kanban một trạng thái đang làm → không có bước
 * xác nhận (tránh gắn nhãn sai).
 */
export function verifyStageStatusIds(workflows: Workflow[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of workflows ?? []) {
    const doing = w.statuses.filter((s) => s.category === 'IN_PROGRESS');
    if (doing.length < 2) continue;
    out.add([...doing].sort((a, b) => b.order - a.order)[0]!.id);
  }
  return out;
}

/** Tách bug tôi báo thành "chờ tôi xác nhận" (đang ở bước cuối) và "còn mở" (phần còn lại); giữ nguyên thứ tự. */
export function splitMyBugs<T extends { status: { id: string } }>(
  issues: T[],
  verifyIds: Set<string>,
): { awaiting: T[]; open: T[] } {
  const awaiting: T[] = [];
  const open: T[] = [];
  for (const i of issues) (verifyIds.has(i.status.id) ? awaiting : open).push(i);
  return { awaiting, open };
}
