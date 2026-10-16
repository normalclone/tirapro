/** Tối đa số mục heuristic đề xuất một lần. */
const MAX_ITEMS = 15;
const MIN_ITEM_LEN = 4;

/** Ký hiệu đầu dòng: "- ", "* ", "• ", "1. ", "2) " — KHÔNG ăn chữ số đầu của "2FA …". */
const LEADING_MARK = /^\s*(?:[-*•]+|\d+[.)])\s+/;

const BUG_RE =
  /(?<![\p{L}])(?:lỗi|bug|sửa lỗi|fix|crash|sập|hỏng|không (?:chạy|hoạt động|đăng nhập được))(?![\p{L}])/iu;
const STORY_RE =
  /(?<![\p{L}])(?:với tư cách|tôi muốn|người dùng (?:muốn|có thể|cần)|as a|user story)(?![\p{L}])/iu;

/**
 * Tách văn bản yêu cầu thành các mục (heuristic, khi chưa có AI):
 * cắt theo dòng; chỉ khi cả văn bản là MỘT dòng mới cắt thêm theo câu / dấu • (KHÔNG cắt theo `;`);
 * bỏ ký hiệu đầu dòng; bỏ dòng dẫn nhập kết thúc bằng ":"; bỏ mục quá ngắn; khử trùng giữ thứ tự; tối đa 15.
 * Không còn mục nào (vd chỉ có dòng dẫn nhập) → dùng nguyên văn bản như một mục.
 */
export function splitRequirements(text: string): string[] {
  const whole = text.normalize('NFC').trim();
  if (!whole) return [];
  const lines = whole
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const chunks = lines.length === 1 ? whole.split(/(?<=[.!?])\s+|\s*•\s*/) : lines;
  const items = chunks
    .map((c) => c.replace(LEADING_MARK, '').trim())
    .filter((c) => c.length >= MIN_ITEM_LEN && !c.endsWith(':'));
  const uniq = Array.from(new Set(items)).slice(0, MAX_ITEMS);
  return uniq.length ? uniq : [whole];
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
