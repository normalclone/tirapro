import type { Placement } from '@/lib/rankDrop';

/** Thả một dòng backlog: bỏ qua nếu không có gì đổi; ngược lại cho biết sprint đích (null = Backlog) và có đổi sprint không. */
export function planBacklogDrop(
  issue: { sprintId: string | null },
  p: Placement,
  backlogId: string,
): { ignore: true } | { ignore: false; targetSprintId: string | null; sprintChanged: boolean } {
  const targetSprintId = p.containerId === backlogId ? null : p.containerId;
  const sprintChanged = (issue.sprintId ?? null) !== targetSprintId;
  if (!sprintChanged && p.unchanged) return { ignore: true };
  return { ignore: false, targetSprintId, sprintChanged };
}
