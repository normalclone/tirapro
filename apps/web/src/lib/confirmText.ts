/**
 * Chuẩn hoá chữ gõ để xác nhận: cắt khoảng trắng hai đầu, gộp khoảng trắng liên tiếp thành một dấu cách, đưa về NFC
 * (dấu tiếng Việt gõ rời/dựng sẵn đều như nhau). KHÔNG đổi hoa/thường — "ci" khác "CI".
 */
export function normalizeConfirmText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').normalize('NFC');
}

/** Chữ người dùng gõ có khớp chữ yêu cầu không. Chữ yêu cầu rỗng → luôn `false` (không có gì để gõ thì không mở khoá). */
export function matchesConfirmText(input: string, expected: string): boolean {
  const want = normalizeConfirmText(expected);
  return want !== '' && normalizeConfirmText(input) === want;
}

/**
 * Enter trong ô gõ có được phép xác nhận không. Chặn mọi kiểu "Enter chốt bộ gõ": `isComposing` (Chrome/Firefox),
 * `keyCode === 229` và Enter đến ngay sau `compositionend` (Safari phát compositionend TRƯỚC, rồi mới tới Enter với
 * `isComposing === false`). Một thao tác xoá cứng không được xác nhận nhầm bằng phím chốt chữ.
 */
export function shouldSubmitOnEnter(e: {
  key: string;
  isComposing: boolean;
  keyCode: number;
  justComposed: boolean;
  matches: boolean;
}): boolean {
  return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !e.justComposed && e.matches;
}
