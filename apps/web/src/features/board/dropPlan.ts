import type { DropResolution } from './dropTarget';

export type DropPlan = 'ignore' | 'reorder' | 'status' | 'assign';

/** Quyết định làm gì khi thả thẻ: đổi người (đường cũ) > đổi cột > đổi chỗ trong cột > bỏ qua. */
export function planDrop(a: {
  resKind: DropResolution['kind'];
  assigneeChanged: boolean;
  unchanged: boolean;
}): DropPlan {
  if (a.assigneeChanged) return 'assign';
  if (a.resKind === 'stay') return a.unchanged ? 'ignore' : 'reorder';
  return 'status';
}
