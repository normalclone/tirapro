/** Số mục heuristic hiển thị cho một lượt phân tích (phần dư trả riêng để người dùng phân tích tiếp). */
export const MAX_ITEMS = 15;
/** Trần an toàn cho tổng số mục tách được từ một văn bản. */
const MAX_ALL_ITEMS = 200;
const MIN_ITEM_LEN = 4;

/**
 * Ký hiệu đầu dòng: "- ", "* ", "• ", "1. ", "2) " (cần khoảng trắng), hoặc "1.Làm" (số + chấm + chữ);
 * KHÔNG ăn chữ số đầu của "2FA …" hay "2.5 giây". Tiền tố checkbox markdown "[ ] "/"[x] " bỏ kèm, giữ nội dung.
 */
const LEADING_MARK = /^\s*(?:(?:[-*•]+|\d+[.)])\s+|\d+[.)](?=\p{L}))(?:\[[ xX]?\]\s*)?/u;
/** Hàng rào mã ``` / ~~~ (kèm tên ngôn ngữ) và tiêu đề markdown "## …" — không phải việc cần làm. */
const NOISE_LINE = /^\s*(?:`{3,}|~{3,}|#{1,6}\s)/;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;
const NUMBERED_START = /^\s*\d+[.)]\s/;

const BUG_RE =
  /(?<![\p{L}])(?:lỗi|bug|sửa lỗi|fix|crash|sập|hỏng|không (?:chạy|hoạt động|đăng nhập được))(?![\p{L}])/iu;
const STORY_RE =
  /(?<![\p{L}])(?:với tư cách|tôi muốn|người dùng (?:muốn|có thể|cần)|as a|user story)(?![\p{L}])/iu;

/**
 * Tách văn bản yêu cầu thành TẤT CẢ các mục (heuristic, khi chưa có AI):
 * cắt theo dòng; chỉ khi cả văn bản là MỘT dòng mới cắt thêm (theo số thứ tự "1. … 2. …" nếu dòng bắt đầu bằng số,
 * còn không theo câu / dấu •) — KHÔNG cắt theo `;`; bỏ ký hiệu đầu dòng, hàng rào mã, dòng kẻ, tiêu đề markdown,
 * dòng dẫn nhập kết thúc bằng ":"; bỏ mục quá ngắn; khử trùng giữ thứ tự.
 * Không còn mục nào (vd chỉ có dòng dẫn nhập) → dùng nguyên văn bản như một mục.
 */
export function splitRequirementsAll(text: string): string[] {
  const whole = text.normalize('NFC').trim();
  if (!whole) return [];
  const lines = whole
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE_LINE.test(l));
  let chunks = lines;
  if (lines.length === 1) {
    chunks = NUMBERED_START.test(lines[0]!)
      ? lines[0]!.split(/\s+(?=\d+[.)]\s)/)
      : lines[0]!.split(/(?<=[.!?])\s+|\s*•\s*/);
  }
  const items = chunks
    .map((c) => c.replace(LEADING_MARK, '').trim())
    .filter((c) => c.length >= MIN_ITEM_LEN && HAS_WORD_CHAR.test(c) && !c.endsWith(':'));
  const uniq = Array.from(new Set(items)).slice(0, MAX_ALL_ITEMS);
  return uniq.length ? uniq : [whole];
}

/** `MAX_ITEMS` mục đầu của {@link splitRequirementsAll}. */
export function splitRequirements(text: string): string[] {
  return splitRequirementsAll(text).slice(0, MAX_ITEMS);
}

/**
 * Đoán loại công việc từ câu chữ. Dùng lookaround `\p{L}` thay `\b` vì `\b` của JS không coi chữ có dấu
 * (ỗ, ử …) là ký tự từ. Không đoán Epic (cần ngữ cảnh).
 */
export function guessIssueType(s: string): 'Bug' | 'Story' | 'Task' {
  const t = s.normalize('NFC');
  if (BUG_RE.test(t)) return 'Bug';
  if (STORY_RE.test(t)) return 'Story';
  return 'Task';
}
