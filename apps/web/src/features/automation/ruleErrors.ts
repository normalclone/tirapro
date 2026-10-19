import { createRuleSchema, type CreateRuleInput } from '@tirapro/shared';
import type { FieldError } from '@/lib/formErrors';

/** Id các khối cố định của hộp "Quy tắc mới" — nơi `ErrorSummary`/`focusFirstError` tìm phần tử. */
export const RULE_NAME_ID = 'rule-name';
export const RULE_TRIGGER_ID = 'rule-trigger';
export const RULE_CONDITIONS_ID = 'rule-conditions';
export const RULE_ACTIONS_ID = 'rule-actions';

/** Id theo ID HÀNG NHÁP (không theo chỉ số) để xoá/thêm hàng không làm lệch lỗi và `aria-describedby`. */
export const conditionFieldId = (rowId: string): string => `rule-cond-${rowId}`;
export const conditionJqlId = (rowId: string): string => `rule-cond-${rowId}-jql`;
export const actionFieldId = (rowId: string, key: string): string => `rule-act-${rowId}-${key}`;

/** Id hàng nháp theo thứ tự trong payload: `conditions[i]` ↔ `conditions[i]` của bản nháp (toPayload giữ nguyên thứ tự). */
export interface RuleDraftIds {
  conditions: readonly string[];
  actions: readonly string[];
}

export interface RuleIssueLike {
  path: readonly (string | number)[];
  message: string;
  code?: string;
}

/** Tên ô của từng khoá hành động; cũng là thứ tự ô trong một hành động (để xếp lỗi theo thứ tự trang). */
const ACTION_KEYS: ReadonlyArray<readonly [key: string, label: string, fallback: string]> = [
  ['field', 'Trường cần đặt', 'Hãy chọn trường cần đặt'],
  ['value', 'Giá trị mới', 'Giá trị chưa hợp lệ'],
  ['mode', 'Cách giao', 'Hãy chọn cách giao việc'],
  ['userId', 'Người được giao', 'Hãy chọn người được giao'],
  ['toStatusId', 'Trạng thái đích', 'Hãy chọn trạng thái đích'],
  ['labelId', 'Nhãn', 'Hãy chọn nhãn'],
  ['body', 'Nội dung bình luận', 'Hãy nhập nội dung bình luận'],
  ['message', 'Nội dung thông báo', 'Hãy nhập nội dung thông báo'],
  ['userIds', 'Người nhận', 'Hãy chọn người hoặc vai trò nhận thông báo'],
  ['roles', 'Vai trò nhận', 'Hãy chọn người hoặc vai trò nhận thông báo'],
  ['url', 'Địa chỉ webhook', 'Hãy nhập địa chỉ webhook hợp lệ, bắt đầu bằng http:// hoặc https://'],
  ['secret', 'Khoá bí mật', 'Khoá bí mật chưa hợp lệ'],
  ['summary', 'Tiêu đề việc con', 'Hãy nhập tiêu đề việc con'],
  ['typeId', 'Loại việc con', 'Hãy chọn loại việc con'],
];
const KEY_INFO = new Map(ACTION_KEYS.map(([k, label, fb], i) => [k, { label, fb, rank: i }]));

/** Thông báo mặc định của zod là tiếng Anh thuần ASCII; câu của schema/`superRefine` đều có dấu tiếng Việt. */
const isZodDefault = (m: string): boolean => /^[\x00-\x7F]*$/.test(m);

interface Ranked extends FieldError {
  rank: readonly [number, number, number];
}

function rank(section: number, index = 0, key = 0): readonly [number, number, number] {
  return [section, index, key];
}

function toRanked(issue: RuleIssueLike, ids: RuleDraftIds): Ranked {
  const [head, idx, leaf] = issue.path;
  const raw = issue.message;
  const tooBig = issue.code === 'too_big';
  if (head === 'name')
    return {
      id: RULE_NAME_ID,
      label: 'Tên quy tắc',
      message: isZodDefault(raw) ? 'Hãy đặt tên cho quy tắc' : raw,
      rank: rank(0),
    };
  if (head === 'conditions') {
    const rowId = typeof idx === 'number' ? ids.conditions[idx] : undefined;
    if (rowId === undefined)
      return {
        id: RULE_CONDITIONS_ID,
        label: 'Điều kiện',
        message: tooBig ? 'Tối đa 20 điều kiện' : isZodDefault(raw) ? 'Điều kiện chưa hợp lệ' : raw,
        rank: rank(3, -1),
      };
    const n = (idx as number) + 1;
    if (leaf === 'jql')
      return {
        id: conditionJqlId(rowId),
        label: `Điều kiện ${n} · JQL`,
        message: isZodDefault(raw) ? 'Hãy nhập câu lệnh JQL' : raw,
        rank: rank(3, idx as number),
      };
    return {
      id: conditionFieldId(rowId),
      label: `Điều kiện ${n}`,
      message: isZodDefault(raw) ? 'Điều kiện chưa hợp lệ' : raw,
      rank: rank(3, idx as number),
    };
  }
  if (head === 'actions') {
    const rowId = typeof idx === 'number' ? ids.actions[idx] : undefined;
    if (rowId === undefined)
      return {
        id: RULE_ACTIONS_ID,
        label: 'Hành động',
        message: tooBig
          ? 'Tối đa 20 hành động'
          : isZodDefault(raw)
            ? 'Hãy thêm ít nhất một hành động'
            : raw,
        rank: rank(4, -1),
      };
    const n = (idx as number) + 1;
    const key = typeof leaf === 'string' ? leaf : 'value';
    const info = KEY_INFO.get(key);
    return {
      id: actionFieldId(rowId, key),
      label: `Hành động ${n} · ${info?.label ?? 'Cấu hình'}`,
      message: isZodDefault(raw)
        ? tooBig
          ? 'Nội dung quá dài'
          : (info?.fb ?? 'Giá trị chưa hợp lệ')
        : raw,
      rank: rank(4, idx as number, info?.rank ?? ACTION_KEYS.length),
    };
  }
  // `trigger`, `triggerConfig.*` và mọi thứ còn lại: ô chọn sự kiện kích hoạt.
  return {
    id: RULE_TRIGGER_ID,
    label: 'Sự kiện kích hoạt',
    message: isZodDefault(raw) ? 'Sự kiện kích hoạt chưa hợp lệ' : raw,
    rank: rank(1),
  };
}

/** Một lỗi zod → lỗi gắn trường (id/nhãn/lời tiếng Việt). Thuần, test được. */
export function ruleIssueToFieldError(issue: RuleIssueLike, ids: RuleDraftIds): FieldError {
  const { rank: _rank, ...e } = toRanked(issue, ids);
  return e;
}

export type RuleValidation =
  | { ok: true; data: CreateRuleInput }
  | { ok: false; errors: FieldError[] };

const cmp = (a: readonly number[], b: readonly number[]): number =>
  a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

/**
 * Kiểm payload bằng `createRuleSchema` (đúng như trước, KHÔNG đổi dữ liệu gửi) và trả MỌI lỗi một lượt, xếp theo thứ tự
 * ô trong hộp (tên → sự kiện → điều kiện → hành động; trong hành động theo thứ tự ô), mỗi trường tối đa một dòng.
 */
export function validateRulePayload(payload: unknown, ids: RuleDraftIds): RuleValidation {
  const parsed = createRuleSchema.safeParse(payload);
  if (parsed.success) return { ok: true, data: parsed.data };
  const ranked = parsed.error.issues.map((i) => toRanked(i, ids));
  ranked.sort((a, b) => cmp(a.rank, b.rank)); // sort ổn định: giữ thứ tự zod khi cùng hạng
  const seen = new Set<string>();
  const errors: FieldError[] = [];
  for (const { rank: _r, ...e } of ranked) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    errors.push(e);
  }
  return { ok: false, errors };
}
