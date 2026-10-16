import type { CreateIssueInput } from './create-api';
import { parseTitleTokens, unmatchedTokens, type TokenCtx } from './titleTokens';

/**
 * Dựng input tạo việc từ chữ gõ ở ô thêm nhanh: tách token `! ~ @ ^ #` (cùng parser với hộp tạo việc)
 * thành trường; token ghi đè `extra`. `null` khi tiêu đề (sau khi bỏ token) rỗng.
 * `unmatched` = token không khớp (vẫn nằm trong tiêu đề) để báo người dùng.
 */
export function buildQuickAddInput(
  text: string,
  ctx: TokenCtx,
  d: { projectId: string; typeId: string; extra?: Partial<CreateIssueInput> },
): { input: CreateIssueInput; unmatched: string[] } | null {
  const tk = parseTitleTokens(text, ctx);
  const summary = tk.clean.trim();
  if (!summary) return null;
  const input: CreateIssueInput = {
    projectId: d.projectId,
    typeId: d.typeId,
    summary,
    descriptionFormat: 'MARKDOWN',
    ...d.extra,
    ...(tk.priorityId ? { priorityId: tk.priorityId } : {}),
    ...(tk.assigneeId ? { assigneeId: tk.assigneeId } : {}),
    ...(tk.sprintId ? { sprintId: tk.sprintId } : {}),
    ...(tk.points != null ? { storyPoints: tk.points } : {}),
    ...(tk.dueLocal ? { dueDate: new Date(tk.dueLocal).toISOString() } : {}),
  };
  return { input, unmatched: unmatchedTokens(text, ctx).map((u) => u.text) };
}

/** Loại mặc định cho ô thêm nhanh: khoá đã lưu nếu còn và không phải sub-task; không thì loại đầu không phải sub-task; không thì loại đầu. */
export function pickDefaultType(
  types: { id: string; key: string | null; isSubtask: boolean }[],
  storedKey: string | null,
): string {
  const usable = types.filter((t) => !t.isSubtask);
  return (
    (storedKey ? usable.find((t) => t.key === storedKey)?.id : undefined) ??
    usable[0]?.id ??
    types[0]?.id ??
    ''
  );
}
