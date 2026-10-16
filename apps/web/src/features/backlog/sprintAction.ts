/**
 * Lệnh sprint từ ngoài (Cmd+K…) đi qua URL của Việc chờ: `/p/KEY/backlog?action=create-sprint|start|complete[&sprint=ID]`.
 * Trang Việc chờ đọc tham số, chạy ĐÚNG luồng của nút tương ứng (quyền, hộp xác nhận…) rồi xoá tham số khỏi URL.
 */
export type SprintAction =
  | { action: 'create-sprint' }
  | { action: 'start' | 'complete'; sprintId: string };

const PARAMS = ['action', 'sprint'] as const;

export function parseSprintAction(search: string): SprintAction | null {
  const p = new URLSearchParams(search);
  const action = p.get('action');
  if (action === 'create-sprint') return { action };
  const sprintId = p.get('sprint');
  if ((action === 'start' || action === 'complete') && sprintId) return { action, sprintId };
  return null;
}

export function sprintActionPath(projectKey: string, a: SprintAction): string {
  const q = new URLSearchParams({ action: a.action });
  if (a.action !== 'create-sprint') q.set('sprint', a.sprintId);
  return `/p/${projectKey}/backlog?${q.toString()}`;
}

/** Chuỗi `?…` sau khi bỏ tham số lệnh (giữ nguyên tham số khác như `peek`); rỗng nếu không còn gì. */
export function stripSprintAction(search: string): string {
  const p = new URLSearchParams(search);
  for (const k of PARAMS) p.delete(k);
  const s = p.toString();
  return s ? `?${s}` : '';
}
