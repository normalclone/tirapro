import type { Workflow } from '@/features/workflow-settings/api';

/**
 * Trạng thái "chờ xác nhận" = bước CUỐI trước Done của MỖI quy trình: trạng thái đang làm (IN_PROGRESS, không tính Pending)
 * có bước chuyển thẳng tới trạng thái xong (Bug: Ready for Retest; Standard: In Review; Epic: Awaiting Acceptance). Bước
 * "Huỷ" từ mọi trạng thái mở không tính. Quy trình không khai bước nào như vậy thì lấy trạng thái đang làm có `order` lớn
 * nhất (không tính Pending). CHỈ khi quy trình có ≥ 2 trạng thái đang làm (Kanban một trạng thái → không có bước xác nhận).
 */
export function verifyStageStatusIds(workflows: Workflow[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of workflows ?? []) {
    const doing = w.statuses.filter((s) => s.category === 'IN_PROGRESS' && s.name !== 'Pending');
    if (doing.length < 2) continue;
    const byId = new Map(w.statuses.map((s) => [s.id, s]));
    const closing = doing.filter((s) =>
      w.transitions.some((t) => {
        if (t.fromStatusId !== s.id) return false;
        const to = byId.get(t.toStatusId);
        return to?.category === 'DONE' && !/^(cancel|huỷ)/i.test(to.name);
      }),
    );
    const pool = closing.length > 0 ? closing : doing;
    out.add([...pool].sort((a, b) => b.order - a.order)[0]!.id);
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
