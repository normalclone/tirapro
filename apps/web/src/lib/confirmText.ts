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
