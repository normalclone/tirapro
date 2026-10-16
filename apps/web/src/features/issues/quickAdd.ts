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
  d: {
    projectId: string;
    typeId: string;
    /** Loại được chọn là Epic → bỏ `extra.epicId` (Epic là cấp cao nhất, API cũng từ chối epic lồng epic). */
    typeIsEpic?: boolean;
    extra?: Partial<CreateIssueInput>;
  },
): { input: CreateIssueInput; unmatched: string[] } | null {
  const tk = parseTitleTokens(text, ctx);
  const summary = tk.clean.trim();
  if (!summary) return null;
  const { epicId: _epicId, ...extraNoEpic } = d.extra ?? {};
  const input: CreateIssueInput = {
    projectId: d.projectId,
    typeId: d.typeId,
    summary,
    descriptionFormat: 'MARKDOWN',
    ...(d.typeIsEpic ? extraNoEpic : d.extra),
    ...(tk.priorityId ? { priorityId: tk.priorityId } : {}),
    ...(tk.assigneeId ? { assigneeId: tk.assigneeId } : {}),
    ...(tk.sprintId ? { sprintId: tk.sprintId } : {}),
    ...(tk.points != null ? { storyPoints: tk.points } : {}),
    ...(tk.dueLocal ? { dueDate: new Date(tk.dueLocal).toISOString() } : {}),
  };
  return { input, unmatched: unmatchedTokens(text, ctx).map((u) => u.text) };
}

/** Mã nhớ một loại việc giữa các dự án/lần mở: `key` nếu có, loại tuỳ chỉnh không key thì theo tên. */
export const typeRef = (t: { key: string | null; name?: string }): string =>
  t.key ?? `name:${t.name ?? ''}`;

/**
 * Loại mặc định cho ô thêm nhanh: loại khớp mã đã lưu (`typeRef`) nếu còn và không phải sub-task;
 * không thì loại đầu không phải sub-task; không thì loại đầu.
 */
export function pickDefaultType(
  types: { id: string; key: string | null; name?: string; isSubtask: boolean }[],
  storedRef: string | null,
): string {
  const usable = types.filter((t) => !t.isSubtask);
  return (
    (storedRef ? usable.find((t) => typeRef(t) === storedRef)?.id : undefined) ??
    usable[0]?.id ??
    types[0]?.id ??
    ''
  );
}

/** Loại Epic: `key = EPIC` hoặc cấp phân cấp >= 1 (cùng luật với API `assertEpicValid`). */
export const isEpicType = (t: { key: string | null; hierarchyLevel?: number }): boolean =>
  t.key === 'EPIC' || (t.hierarchyLevel ?? 0) >= 1;
