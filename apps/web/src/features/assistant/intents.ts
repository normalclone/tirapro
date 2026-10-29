import { normalizeVi } from '@/lib/text';
import { guessIssueKey } from '@/features/command/issueKey';

/**
 * Nhận diện ý định của Trợ lý (chế độ cơ bản): LUẬT + từ khoá, không gọi AI/LLM nào, thuần hàm để test.
 * So khớp không dấu, không phân biệt hoa thường (`normalizeVi`); phần chữ người dùng cần giữ nguyên (tiêu đề việc,
 * từ khoá tìm) được cắt từ chuỗi GỐC, không phải chuỗi đã chuẩn hoá.
 */

/** Gợi ý loại việc từ câu lệnh ("thêm bug …" → bug); null = để dự án quyết (mặc định Task). */
export type TypeHint = 'bug' | 'story' | 'epic' | null;

export type Intent =
  | { kind: 'empty' }
  | { kind: 'greeting' }
  /** "Bạn làm được gì?" — liệt kê khả năng + chip gợi ý. */
  | { kind: 'capabilities' }
  /** "Màn này dùng để làm gì", "hướng dẫn màn này", "có gì ở đây". */
  | { kind: 'screen' }
  /** "Tóm tắt việc này" (trang công việc). */
  | { kind: 'issue-summary' }
  /** "Sprint hiện tại thế nào" (trong dự án). */
  | { kind: 'sprint-status' }
  | { kind: 'my-issues' }
  | { kind: 'overdue' }
  | { kind: 'due'; period: 'week' | 'today' }
  /** Có mã công việc trong câu ("BUG-12", "mở DEMO-TASK-3"). */
  | { kind: 'issue-key'; key: string }
  | { kind: 'search'; query: string }
  /** `text` = phần sau câu lệnh (tiêu đề + token `! @ # ~ ^`), có thể rỗng. */
  | { kind: 'create'; typeHint: TypeHint; text: string }
  /** Hỏi cách dùng / FAQ → kho tri thức. `explicit` = câu có dấu hiệu hỏi cách làm ("làm sao…", "ở đâu"). */
  | { kind: 'help'; query: string; explicit: boolean };

interface Word {
  raw: string;
  /** Đã bỏ dấu, hạ chữ thường, bỏ dấu câu ở hai đầu — chỉ để so khớp. */
  fold: string;
  start: number;
}

const fold = (s: string): string => normalizeVi(s).replace(/[?!.,;:()"'“”‘’]+/g, '');

/** Tách từ theo khoảng trắng, nhớ vị trí trong chuỗi gốc để cắt phần còn lại nguyên văn. */
function words(text: string): Word[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({
    raw: m[0],
    fold: fold(m[0]),
    start: m.index ?? 0,
  }));
}

/** Khớp một cụm nhiều từ (đã chuẩn hoá, cách nhau bằng khoảng trắng) tại vị trí `i`; trả số từ khớp (0 = không). */
function phraseAt(ws: Word[], i: number, phrases: readonly string[]): number {
  let best = 0;
  for (const p of phrases) {
    const parts = p.split(' ');
    if (parts.length > best && parts.every((w, k) => ws[i + k]?.fold === w)) best = parts.length;
  }
  return best;
}

const POLITE = [
  'hay',
  'vui long',
  'giup',
  'giup toi',
  'giup minh',
  'nho',
  'toi muon',
  'minh muon',
  'toi can',
  'minh can',
  'can',
  'muon',
  'xin',
  'bot',
  'tro ly',
  'oi',
];
const CREATE_VERBS = ['tao', 'them', 'new', 'create', 'add', 'lap', 'ghi nhan'];
const CREATE_FILLERS = [
  'giup toi',
  'giup minh',
  'giup',
  'cho toi',
  'cho minh',
  'cho',
  'moi',
  'mot',
  '1',
  'cai',
  'new',
];
/** Danh từ sau động từ tạo → gợi ý loại. "sprint", "dự án"… không nằm đây nên "tạo sprint" không bị hiểu là tạo việc. */
const CREATE_NOUNS: { phrase: string; hint: TypeHint }[] = [
  { phrase: 'cong viec', hint: null },
  { phrase: 'viec', hint: null },
  { phrase: 'task', hint: null },
  { phrase: 'issue', hint: null },
  { phrase: 'ticket', hint: null },
  { phrase: 'bug', hint: 'bug' },
  { phrase: 'loi', hint: 'bug' },
  { phrase: 'user story', hint: 'story' },
  { phrase: 'story', hint: 'story' },
  { phrase: 'epic', hint: 'epic' },
];

/** Câu hỏi cách làm — "làm sao tạo task" là hỏi chứ không phải lệnh tạo. */
const HOWTO = /(^| )(lam sao|lam the nao|cach|huong dan|o dau|nhu the nao|sao de|tai sao)( |$)/;

/**
 * Câu lệnh tạo việc: [lời lịch sự] + động từ (tạo/thêm/new…) + [đệm] + danh từ (task/việc/bug/story/epic) + phần còn lại.
 * "báo lỗi X" cũng là tạo bug. `null` nếu không phải lệnh tạo việc. Phần còn lại giữ NGUYÊN VĂN (kể cả token `!cao @an`).
 */
export function parseCreateCommand(text: string): { typeHint: TypeHint; text: string } | null {
  const ws = words(text.trim());
  let i = 0;
  for (;;) {
    const n = phraseAt(ws, i, POLITE);
    if (!n) break;
    i += n;
  }
  const bao = ws[i]?.fold === 'bao' && ws[i + 1]?.fold === 'loi';
  if (bao) {
    i += 2;
    return { typeHint: 'bug', text: restFrom(text, ws, i) };
  }
  const v = phraseAt(ws, i, CREATE_VERBS);
  if (!v) return null;
  i += v;
  for (;;) {
    const n = phraseAt(ws, i, CREATE_FILLERS);
    if (!n) break;
    i += n;
  }
  const noun = CREATE_NOUNS.map((c) => ({ ...c, n: phraseAt(ws, i, [c.phrase]) })).sort(
    (a, b) => b.n - a.n,
  )[0];
  if (!noun || !noun.n) return null;
  i += noun.n;
  i += phraseAt(ws, i, ['moi', 'new']); // "tạo công việc mới: Dọn kho"
  return { typeHint: noun.hint, text: restFrom(text, ws, i) };
}

/** Phần chuỗi gốc từ từ thứ `i`; bỏ dấu `-`/`:` rời ngăn cách đứng ngay sau danh từ ("tạo task - Sửa lỗi"). */
function restFrom(text: string, ws: Word[], i: number): string {
  const from = ws[i]?.start ?? text.length;
  return text
    .slice(from)
    .trim()
    .replace(/^[-–—:]\s*/, '');
}

/** "tạo/bắt đầu/kết thúc sprint" là hỏi cách làm, không phải hỏi tình trạng sprint. */
const SPRINT_ACTION = /(tao|them|bat dau|ket thuc|xoa|dong|lap|chuyen) (moi )?sprint/;

/** Phần "tiêu đề" thực ra là câu hỏi ngắn → không tạo việc. */
const QUESTION_TAIL = /^(the nao|ra sao|nhu the nao|o dau|duoc khong|la gi|duoc nhi)$/;

const HELLO = /^(xin chao|chao|hello|hi|hey|alo|chao ban|chao bot|hello bot|hi bot)$/;
const CAPS =
  /^(help|tro giup|giup|giup toi|ban lam duoc gi|ban co the lam gi|ban giup duoc gi|tro ly lam duoc gi|co the lam gi|lam duoc gi|ban la ai)$/;

const has = (n: string, re: RegExp) => re.test(n);

/** Mã công việc đứng riêng trong câu (bỏ dấu câu ở hai đầu từ). */
function findIssueKey(text: string): string | null {
  for (const w of text.split(/\s+/)) {
    const k = guessIssueKey(w.replace(/^[(“"'\[]+|[?!.,;:)”"'\]]+$/g, ''));
    if (k) return k;
  }
  return null;
}

/** "tìm <từ khoá>" / "tìm kiếm việc <từ khoá>" → từ khoá nguyên văn; `null` nếu không phải lệnh tìm. */
function parseSearch(text: string): string | null {
  const ws = words(text.trim());
  let i = 0;
  for (;;) {
    const n = phraseAt(ws, i, POLITE);
    if (!n) break;
    i += n;
  }
  const v = phraseAt(ws, i, ['tim kiem', 'tim', 'search', 'find', 'loc']);
  if (!v) return null;
  i += v;
  i += phraseAt(ws, i, ['cong viec', 'viec', 'task', 'issue', 'bug', 'ticket']);
  i += phraseAt(ws, i, ['ve', 'voi', 'co', 'chua', 'lien quan', 'theo']);
  const rest = text.slice(ws[i]?.start ?? text.length).trim();
  return (
    rest
      .replace(/^[-–—:]\s*/, '')
      .replace(/^["“'](.*)["”']$/, '$1')
      .trim() || null
  );
}

/** Nhận diện ý định của một câu người dùng gõ. Thứ tự các luật là có chủ ý (lệnh cụ thể trước, hỏi chung sau). */
export function detectIntent(raw: string): Intent {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  const n = fold(text).replace(/\s+/g, ' ').trim();
  const howto = HOWTO.test(n) || SPRINT_ACTION.test(n);

  if (HELLO.test(n)) return { kind: 'greeting' };
  if (CAPS.test(n)) return { kind: 'capabilities' };

  if (!howto) {
    const create = parseCreateCommand(text);
    // "báo lỗi thế nào?" / "tạo task ở đâu" là câu hỏi cách làm, không phải tiêu đề việc.
    if (create && !QUESTION_TAIL.test(fold(create.text))) return { kind: 'create', ...create };
  }

  const here = has(
    n,
    /(man hinh|man|trang) (nay|hien tai|dang xem)|o day|chay tour|tour (man|trang)/,
  );
  if (
    (here &&
      has(
        n,
        /(dung de lam gi|la gi|co gi|lam duoc gi|huong dan|gioi thieu|chuc nang|tour|giai thich|ra sao)/,
      )) ||
    has(n, /^(huong dan|tour|chay huong dan)( tung buoc)?$/)
  )
    return { kind: 'screen' };

  if (!howto) {
    if (
      has(
        n,
        /tom tat.*(viec|task|issue|cong viec|ticket|bug)|(viec|task|issue|cong viec|ticket) (nay|do|dang xem).*(the nao|ra sao|tom tat|tinh hinh)/,
      )
    )
      return { kind: 'issue-summary' };
    if (
      has(n, /sprint/) &&
      has(n, /(hien tai|dang chay|the nao|ra sao|tien do|tinh hinh|con bao nhieu|active)/)
    )
      return { kind: 'sprint-status' };
    if (has(n, /(qua han|tre han|tre deadline|overdue|het han roi)/)) return { kind: 'overdue' };
    if (has(n, /(den han|sap han|deadline|han chot)/)) {
      if (has(n, /hom nay/)) return { kind: 'due', period: 'today' };
      if (has(n, /(tuan nay|tuan)/)) return { kind: 'due', period: 'week' };
    }
    if (
      has(
        n,
        /(viec|task|issue|cong viec|ticket|bug|loi)( cua)? (toi|minh)( dang lam)?( duoc giao)?($| )/,
      ) ||
      has(
        n,
        /(toi|minh) (duoc giao|dang lam|phai lam)|giao cho (toi|minh)|assigned to me|my (tasks|issues)/,
      )
    )
      return { kind: 'my-issues' };
    const search = parseSearch(text);
    if (search) return { kind: 'search', query: search };
    const key = findIssueKey(text);
    if (key) return { kind: 'issue-key', key };
  }

  return { kind: 'help', query: text, explicit: howto || text.includes('?') };
}
