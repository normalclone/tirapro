/** Màu theo NHÓM trạng thái (StatusCategory). Nguồn dùng chung cho board/gantt/tree/relations/filters. */
export const CATEGORY_COLOR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

/** Màu chấm/nền theo category, fallback về TODO. */
export const categoryColor = (category: string | null | undefined): string =>
  (category && CATEGORY_COLOR[category]) || 'var(--status-todo)';
