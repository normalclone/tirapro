import type { RuleCondition } from '@tirapro/shared';
import { FIELD_LABELS, OP_LABELS } from './rules-api';

/**
 * Từ nối giữa các điều kiện. LUÔN là "và": engine tự động hoá chỉ hỗ trợ VÀ (`firstUnmetCondition` dừng ở điều kiện đầu
 * tiên không thoả). Hiện "hoặc" khi engine vẫn VÀ là nói sai — cần HOẶC thì dùng MỘT điều kiện JQL có OR.
 */
export const CONDITION_JOINER = 'và';
export const OR_HINT = 'Cần HOẶC? Dùng một điều kiện JQL có OR.';
export const NO_CONDITIONS_TEXT =
  'Chưa có điều kiện — quy tắc chạy ở mọi công việc khớp sự kiện ở bước 1.';

/** Tra tên hiển thị của một mã (trạng thái, mức ưu tiên, người…) theo trường; không biết → `undefined`. */
export type NameOf = (field: string, id: string) => string | undefined;

const MISSING = '(chưa chọn)';
const ID_FIELDS = new Set([
  'statusId',
  'priorityId',
  'assigneeId',
  'reporterId',
  'typeId',
  'sprintId',
  'resolutionId',
  'labelIds',
]);

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Một giá trị đơn → chữ; rỗng/NaN/kiểu lạ → `null` (nơi gọi hiện "…"). */
function scalar(field: string, v: unknown, nameOf: NameOf): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '') return null;
  if (ID_FIELDS.has(field)) return nameOf(field, s) ?? s;
  const d = isoDate.exec(s);
  if (field === 'dueDate' && d) return `${d[3]}/${d[2]}/${d[1]}`;
  return s;
}

/** "Loại công việc là Bug", "Mức ưu tiên là một trong High, Highest", "Người làm đang trống". Thuần. */
export function describeCondition(c: RuleCondition, nameOf: NameOf): string {
  if ('jql' in c) return `khớp bộ lọc JQL: ${c.jql.trim() || MISSING}`;
  const field = FIELD_LABELS[c.field] ?? c.field;
  const op = OP_LABELS[c.op] ?? c.op;
  if (c.op === 'empty' || c.op === 'notEmpty') return `${field} ${op}`;
  let value: string;
  if (Array.isArray(c.value)) {
    const parts = c.value.flatMap((x) => {
      const t = scalar(c.field, x, nameOf);
      return t === null ? [] : [t];
    });
    value = parts.length ? parts.join(', ') : MISSING;
  } else {
    const t = scalar(c.field, c.value, nameOf);
    value = t === null ? MISSING : c.field === 'summary' ? `"${t}"` : t; // tiêu đề là chữ tự do → đặt trong ngoặc kép
  }
  return `${field} ${op} ${value}`;
}

/** Mỗi điều kiện một mệnh đề, theo thứ tự; nơi vẽ tự chèn `CONDITION_JOINER` (in đậm) giữa các mệnh đề. */
export function conditionClauses(conditions: readonly RuleCondition[], nameOf: NameOf): string[] {
  return conditions.map((c) => describeCondition(c, nameOf));
}

/** Câu thuần chữ (không định dạng): các mệnh đề nối bằng " và ". Rỗng → ''. */
export function conditionSentenceText(
  conditions: readonly RuleCondition[],
  nameOf: NameOf,
): string {
  return conditionClauses(conditions, nameOf).join(` ${CONDITION_JOINER} `);
}
