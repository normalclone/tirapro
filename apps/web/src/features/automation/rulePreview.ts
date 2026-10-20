import { parseJql } from '@tirapro/shared';
import { fmtNumber } from '@/lib/locale';

/** Điều kiện nháp ở dạng cấu trúc tối thiểu (khớp `CondDraft` của RuleEditor, không import ngược). */
type DraftLike =
  | { kind: 'field'; field: string; op: string; value: string; values: string[] }
  | { kind: 'jql'; jql: string };

/** Phản hồi POST /automation/rules/preview-match. */
export interface PreviewMatch {
  count: number | null;
  reason: string | null;
  timedOut: boolean;
  currentUserInJql: boolean;
}

/** Điều kiện nháp đã đủ để đếm? Còn dở (trống, sai cú pháp JQL, số/ngày chưa đúng) → tắt xem trước, khỏi gọi API. */
export function isCondDraftComplete(c: DraftLike): boolean {
  if (c.kind === 'jql') {
    const j = c.jql.trim();
    if (!j) return false;
    try {
      parseJql(j);
      return true;
    } catch {
      return false;
    }
  }
  if (c.op === 'empty' || c.op === 'notEmpty') return true;
  if (c.op === 'in' || c.op === 'nin') {
    return c.values.length > 0 && c.values.every((v) => v.trim() !== '');
  }
  const v = c.value.trim();
  if (v === '') return false;
  if (c.field === 'storyPoints') return Number.isFinite(Number(v));
  if (c.field === 'dueDate') return /^\d{4}-\d{2}-\d{2}$/.test(v);
  return true;
}

const CURRENT_USER_WARNING = 'currentUser() không có nghĩa trong tự động hoá';

export interface PreviewViewInput {
  hasConditions: boolean;
  /** Đang chờ debounce hoặc đang gọi API. */
  pending: boolean;
  isError: boolean;
  data?: PreviewMatch;
  /** Quy tắc cấp dự án (true) hay cả workspace (false). */
  scoped: boolean;
}

/**
 * Dòng chữ dưới câu điều kiện. `null` = không hiện gì (không có điều kiện, hoặc lỗi — API cũ 404/mạng thì lặng lẽ bỏ qua,
 * đây là phần phụ của biểu mẫu). Đang đếm thì không giữ số cũ: số lệch với điều kiện đang gõ còn tệ hơn không có số.
 */
export function previewView(a: PreviewViewInput): { text: string; warning: string | null } | null {
  if (!a.hasConditions || a.isError) return null;
  if (a.pending || !a.data) return { text: 'Đang đếm…', warning: null };
  const warning = a.data.currentUserInJql ? CURRENT_USER_WARNING : null;
  if (a.data.timedOut) return { text: 'không đếm kịp', warning };
  if (a.data.count === null) return { text: a.data.reason ?? 'không đếm được', warning };
  const scope = a.scoped ? '' : ' (trong các dự án bạn xem được)';
  return { text: `Khớp ${fmtNumber(a.data.count)} việc hiện có${scope}`, warning };
}
