import { blockOnInvalidDate } from './dateGuard';

/** Một lỗi gắn với một trường: `id` là id phần tử trong trang (ô nhập, trigger, radiogroup, fieldset…). */
export interface FieldError {
  id: string;
  label: string;
  message: string;
}

/** Viền + ring đỏ kể cả khi đang focus (đè `focus-visible:border-primary`). Token danger, không màu mới. */
export const INVALID_FIELD_CLS =
  'border-danger focus-visible:!border-danger focus-visible:ring-danger/40';

/** "3 trường cần sửa" (tiếng Việt không chia số nhiều). 0 → ''. */
export function errorCountLabel(n: number): string {
  return n > 0 ? `${n} trường cần sửa` : '';
}

/** Id lời lỗi của một trường — ổn định theo id trường để `aria-describedby` trỏ tới. */
export const fieldErrorId = (fieldId: string): string => `${fieldId}-error`;

/** Nối các id có giá trị bằng dấu cách cho `aria-describedby`; không có gì → undefined. */
export function describedBy(...ids: (string | undefined | null | false)[]): string | undefined {
  const out = ids.filter((x): x is string => typeof x === 'string' && x !== '');
  return out.length > 0 ? out.join(' ') : undefined;
}

export interface InvalidAttrs {
  ariaInvalid: true | undefined;
  describedBy: string | undefined;
  /** Id lời lỗi sẽ được vẽ (chỉ khi `invalid` là chuỗi). */
  errorId: string | null;
  errorText: string | null;
}

/**
 * Quy `invalid` (boolean hoặc chuỗi lời lỗi) về thuộc tính truy cập. Chuỗi không rỗng = có lỗi + vẽ lời lỗi với id
 * `fieldErrorId(fieldId)`, `describedBy` = gợi ý cũ + id lỗi (cách nhau dấu cách). `true` = có lỗi, lời lỗi do nơi khác vẽ.
 */
export function invalidAttrs(
  invalid: boolean | string | undefined,
  fieldId: string,
  existingDescribedBy?: string,
): InvalidAttrs {
  const text = typeof invalid === 'string' && invalid.trim() !== '' ? invalid : null;
  const errorId = text ? fieldErrorId(fieldId) : null;
  return {
    ariaInvalid: invalid === true || text ? true : undefined,
    describedBy: describedBy(existingDescribedBy, errorId),
    errorId,
    errorText: text,
  };
}

const FOLLOWING = 4; // `other` đứng SAU phần tử này

/**
 * Xếp lỗi theo thứ tự ô xuất hiện trong trang (không theo thứ tự validate trả về). Lỗi không có phần tử (ẩn/không vẽ)
 * bị bỏ. Thuần: nhận hàm tra phần tử nên test được không cần DOM.
 */
export function sortByDocumentOrder<T, E extends { compareDocumentPosition(other: E): number }>(
  items: readonly T[],
  elOf: (item: T) => E | null | undefined,
): T[] {
  const withEl = items.flatMap((item) => {
    const el = elOf(item);
    return el ? [{ item, el }] : [];
  });
  withEl.sort((a, b) => {
    if (a.el === b.el) return 0;
    return a.el.compareDocumentPosition(b.el) & FOLLOWING ? -1 : 1;
  });
  return withEl.map((x) => x.item);
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Ô nhận focus được: chính nó nếu là điều khiển, hoặc điều khiển đầu tiên bên trong (fieldset/radiogroup/nhóm). */
function focusTargetOf(el: HTMLElement): HTMLElement {
  if (el.matches(FOCUSABLE)) return el;
  return (
    el.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ??
    el.querySelector<HTMLElement>(FOCUSABLE) ??
    el
  );
}

function reveal(el: HTMLElement): void {
  const target = focusTargetOf(el);
  if (target === el && !el.matches(FOCUSABLE) && el.tabIndex < 0 && !el.hasAttribute('tabindex'))
    el.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center' });
}

/** Đưa focus tới trường có id `id` (nhóm → điều khiển đầu tiên). `false` nếu không có trong trang. */
export function focusField(id: string, doc: Document = document): boolean {
  const el = doc.getElementById(id);
  if (!el) return false;
  reveal(el);
  return true;
}

/**
 * Đưa tới lỗi ĐẦU TIÊN theo thứ tự trong trang. Có `errors` → lấy ô của các lỗi đó; không có → quét `root`
 * (mặc định cả tài liệu): `[aria-invalid="true"]` trước, rồi ô ngày sai (`blockOnInvalidDate`, cũng hiện bong bóng lỗi).
 * Trả `true` nếu đã đưa tới một ô.
 */
export function focusFirstError(
  errors?: readonly FieldError[],
  root: ParentNode = document,
): boolean {
  if (errors) {
    const [first] = sortByDocumentOrder(errors, (e) => document.getElementById(e.id));
    return first ? focusField(first.id) : false;
  }
  const bad = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (bad) {
    reveal(bad);
    return true;
  }
  return blockOnInvalidDate(root);
}
