/**
 * Gấp chữ thường NHẤT QUÁN giữa JS (engine quy tắc, `evalFieldCondition`) và Postgres (`ILIKE` của xem trước/lọc, vốn gọi
 * `lower()` của DB). Hai bên mặc định KHÔNG giống nhau với chữ hiếm (đo trên Postgres thật, ruling RC20): JS `toLowerCase` theo
 * "full case mapping" có ngữ cảnh — `İ` → `i̇` (2 ký tự), `Σ` cuối từ → `ς` — còn `lower()` của glibc theo ánh xạ đơn giản từng
 * ký tự (`İ` → `i`, `Σ` → `σ`) và có chỗ bỏ sót (ǅ, chữ mới của Unicode, vài lỗi tra bảng ở nhóm Hy Lạp).
 *
 * Cách làm: (1) `foldCase` gấp từng ký tự theo ánh xạ đơn giản — engine dùng nó; (2) `isPgFoldSafe` nhận ra những chuỗi mà hai
 * bên CHẮC CHẮN gấp giống nhau (Latin gồm tiếng Việt, dấu kết hợp NFD, ký tự không có hoa/thường như số/dấu câu/emoji/CJK).
 * `contains` có giá trị ngoài tập đó thì xem trước trả "không xem trước được" thay vì đếm xấp xỉ.
 * Phía dữ liệu cũng an toàn: mọi ký tự lệch giữa JS và Postgres đều gấp ra ký tự NGOÀI tập an toàn, trừ `İ` (đã xử lý ở
 * `foldCase`). Spec tích hợp `rule-preview.parity.int-spec.ts` quét TOÀN BỘ điểm mã trên Postgres đích để giữ điều này.
 */

/** Gấp chữ thường từng ký tự (điểm mã), không theo ngữ cảnh, không chuẩn hoá Unicode. */
export function foldCase(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    // Chỉ `İ` (U+0130) cho ra nhiều điểm mã; ánh xạ đơn giản của nó là "i" — điểm mã đầu của kết quả.
    out += [...lower].length > 1 ? String.fromCodePoint(lower.codePointAt(0)!) : lower;
  }
  return out;
}

/** Khoảng điểm mã CÓ hoa/thường mà JS và Postgres (glibc) gấp giống nhau — Latin gồm tiếng Việt. Đã đối chiếu từng ký tự. */
const CASED_SAFE: ReadonlyArray<readonly [number, number]> = [
  [0x41, 0x5a], // A-Z
  [0x61, 0x7a], // a-z
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x12f], // Latin-1 + Latin Extended-A (trước İ/ı)
  [0x132, 0x1c3], // Latin Extended-A/B (sau ı, trước các chữ ghép Ǆ ǅ ǆ …)
  [0x1cd, 0x1f0],
  [0x1f4, 0x24f],
  [0x1e00, 0x1e9d], // Latin Extended Additional (tiếng Việt: ẠẢẤẦ… ở 1EA0–1EFF)
  [0x1ea0, 0x1eff],
];
const inCasedSafe = (cp: number): boolean => CASED_SAFE.some(([a, b]) => cp >= a && cp <= b);

/** Nhóm chữ Hy Lạp (có lỗi tra bảng ở glibc, vd U+038E) — không bao giờ coi là an toàn, kể cả ký tự "không có hoa/thường". */
const isGreek = (cp: number): boolean =>
  (cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff);

/** Điểm mã không có ánh xạ hoa/thường nào (số, dấu câu, dấu kết hợp, emoji, CJK…) và không thuộc nhóm Hy Lạp. */
function isUncased(ch: string, cp: number): boolean {
  return ch.toLowerCase() === ch && ch.toUpperCase() === ch && !isGreek(cp);
}

/** Mọi điểm mã của `s` thuộc tập mà JS (`foldCase`) và `lower()` của Postgres chắc chắn gấp giống nhau. */
export function isPgFoldSafe(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (!inCasedSafe(cp) && !isUncased(ch, cp)) return false;
  }
  return true;
}
