import { normalizeVi } from '@/lib/text';
import { guessIssueKey } from '@/features/command/issueKey';

/**
 * Phân tích câu lệnh THAO TÁC HÀNG LOẠT của Trợ lý (giao việc, thêm / gỡ thành viên dự án): LUẬT, không AI, thuần hàm.
 * Kết quả chỉ là cấu trúc "người dùng đã gõ gì" (tên/mã còn NGUYÊN VĂN, dải mã đã bung); khớp với người/dự án/việc thật nằm ở
 * `bulkResolve.ts` + `bulkPlan.ts`. Không có gì ở đây ghi dữ liệu — mọi thao tác đều qua thẻ xem trước + Xác nhận.
 */

/** Trần số việc/dòng cho một lệnh (khớp giới hạn sửa hàng loạt: 100 việc mỗi dự án mỗi lần, vài dự án một lệnh). */
export const BULK_MAX_ITEMS = 200;

export type BulkIssueType = 'bug' | 'task' | 'sub-task' | 'story';

/** Bộ lọc nhẹ ("các việc [Test] chưa giao của KYHOP"). Mọi trường đều tuỳ chọn; `project` là mã người dùng gõ (chưa kiểm). */
interface BulkFilter {
  /** Tiền tố tiêu đề, GIỮ cả dấu ngoặc: `[Test]`. */
  titlePrefix?: string;
  unassigned?: boolean;
  project?: string;
  type?: BulkIssueType;
  /** Chỉ việc thuộc Epic này (theo mã). */
  epicKey?: string;
}

export type IssueSelector =
  /** Danh sách mã đã bung (`11, 12`, `11..20`). */
  | { kind: 'keys'; keys: string[] }
  /** "việc con của KYHOP-TASK-12". */
  | { kind: 'children'; parentKey: string }
  | { kind: 'filter'; filter: BulkFilter };

export interface BulkAssignIntent {
  kind: 'bulk-assign';
  /** Câu gốc — chỉ do `parseBulkCommand` (đường `detectIntent`) điền, để `respond` nhường ý định cũ khi không khớp được gì. */
  raw?: string;
  /** `null` khi là kiểu theo cặp (dùng `pairs`) hoặc không hiểu được phạm vi việc (xem `problems`). */
  selector: IssueSelector | null;
  /** Tên/email người nhận NGUYÊN VĂN ("tôi"/"mình" = chính người gõ). */
  people: string[];
  /** Kiểu theo cặp: mỗi mã một người. */
  pairs: { key: string; person: string }[] | null;
  /** Lỗi cú pháp tiếng Việt (dải ngược, quá nhiều, số trần không có tiền tố…) — thẻ/trả lời hiển thị nguyên văn. */
  problems: string[];
}

/** Dự án đích: danh sách tham chiếu (mã/tên, nguyên văn) và/hoặc MỘT nhóm dự án cá nhân ("nhóm X của tôi"). */
interface ProjectTargets {
  refs: string[];
  group: string | null;
  /** Chỉ có khi người dùng gõ trần "nhóm QA" (không "của tôi", không "dự án") — có thể là team của tổ chức → kế hoạch hỏi lại. */
  groupLoose?: true;
}

export interface BulkAddMemberIntent {
  kind: 'bulk-add-member';
  raw?: string;
  /** Tên/email người được thêm. */
  people: string[];
  /** Tên team của tổ chức ("Nhóm QA" đứng ở vế người được thêm). */
  teams: string[];
  targets: ProjectTargets;
  /** Vai trò người dùng gõ (nguyên văn); null = chưa nói. */
  role: string | null;
  problems: string[];
}

export interface BulkRemoveMemberIntent {
  kind: 'bulk-remove-member';
  raw?: string;
  people: string[];
  targets: ProjectTargets;
  problems: string[];
}

export type BulkIntent = BulkAssignIntent | BulkAddMemberIntent | BulkRemoveMemberIntent;

/* ------------------------------ tiện ích chuỗi ------------------------------ */

interface Word {
  raw: string;
  fold: string;
  start: number;
}

const fold = (s: string): string => normalizeVi(s).replace(/[?!.,;:()"'“”‘’]+/g, '');

function words(text: string): Word[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({
    raw: m[0],
    fold: fold(m[0]),
    start: m.index ?? 0,
  }));
}

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

function skipPolite(ws: Word[], from = 0): number {
  let i = from;
  for (;;) {
    const n = phraseAt(ws, i, POLITE);
    if (!n) return i;
    i += n;
  }
}

/** Đuôi lịch sự cuối câu ("… cho Linh nhé", "giúp mình"). Chỉ từ KHÔNG thể là tên người ("Hà", "A" là tên nên không có ở đây). */
const TAIL_POLITE = /\s+(nhe|nha|nhi|giup|giup toi|giup minh|gium)\s*$/;

/** Bỏ đuôi lịch sự + dấu câu cuối, giữ chữ gốc. */
function trimTail(s: string): string {
  let out = s
    .trim()
    .replace(/[.!?;:]+$/, '')
    .trim();
  for (;;) {
    const folded = fold(out);
    const m = TAIL_POLITE.exec(` ${folded}`);
    if (!m) return out;
    // Cắt đúng số từ đã khớp trên chuỗi gốc.
    const cut = m[1]!.split(' ').length;
    const ws = words(out);
    if (ws.length <= cut) return out;
    out = out
      .slice(0, ws[ws.length - cut]!.start)
      .trim()
      .replace(/[.!?;:]+$/, '')
      .trim();
  }
}

/** Tách danh sách người/dự án theo `,` `;` `&` và các từ "và"/"and"/"với" — bỏ phần rỗng, giữ chữ gốc. */
function splitList(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  const parts = s.split(/(\s+)/);
  for (const p of parts) {
    const f = fold(p);
    if (/^\s+$/.test(p)) {
      cur += p;
      continue;
    }
    if (f === 'va' || f === 'and' || f === '&') {
      out.push(cur);
      cur = '';
      continue;
    }
    // Dấu phẩy/chấm phẩy dính vào từ: "Linh," → tách.
    const m = /^(.*?)([,;]+)$/.exec(p);
    if (m) {
      cur += m[1];
      out.push(cur);
      cur = '';
      continue;
    }
    const lead = /^([,;]+)(.+)$/.exec(p);
    if (lead) {
      out.push(cur);
      cur = lead[2]!;
      continue;
    }
    cur += p;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Vị trí (chỉ số từ) của từ có `fold` thuộc `set`, không nằm trong `[...]`; `last` = lấy lần cuối. */
function findWord(ws: Word[], set: readonly string[], from: number, last = false): number {
  let found = -1;
  let depth = 0;
  for (let i = from; i < ws.length; i++) {
    const w = ws[i]!;
    depth += (w.raw.match(/\[/g)?.length ?? 0) - (w.raw.match(/\]/g)?.length ?? 0);
    if (depth > 0) continue;
    if (set.includes(w.fold)) {
      found = i;
      if (!last) return i;
    }
  }
  return found;
}

const sliceWords = (text: string, ws: Word[], from: number, to: number): string =>
  text.slice(ws[from]?.start ?? text.length, to < ws.length ? ws[to]!.start : text.length).trim();

/* ------------------------------ mã công việc: danh sách + dải ------------------------------ */

const KEY_PREFIX = '[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z][A-Za-z0-9]*)*-';
const RANGE_SEP = '(?:\\.\\.\\.?|->|=>|→|-|–|—|\\s+(?:den|đến|tới|toi)\\s+)';
// Một mục: [tiền tố mã]số [dải]. Mã đầy đủ `KYHOP-SUB-11`, số trần `12`, dải `11..20` / `11-20` / `11 đến 20` / `11 -> 20`
// / `KYHOP-SUB-11 đến KYHOP-SUB-20` (đầu dải thứ hai được phép lặp lại đúng tiền tố của đầu dải thứ nhất: `\2`).
// Nhóm 1 = ký tự đứng trước (không dùng lookbehind), 2 = tiền tố, 3 = số đầu, 4 = số cuối.
const ITEM = new RegExp(
  `(^|[^A-Za-z0-9_-])(${KEY_PREFIX})?(\\d+)(?:\\s*${RANGE_SEP}\\s*(?:\\2)?(\\d+))?(?![A-Za-z0-9_])`,
  'giu',
);
const HAS_FULL_KEY = new RegExp(`(?:^|[^A-Za-z0-9_-])${KEY_PREFIX}\\d+(?![A-Za-z0-9_])`, 'iu');
/** Giữa hai mục chỉ có `,` `;` `&` "và" "and" → số trần ở sau được nối trực tiếp vào mục trước. */
const CHAIN_GAP = /^(?:[,;&]|va|and)(?:\s*(?:[,;&]|va|and))*$/;
/** Ngay SAU số trần chỉ được là hết đoạn / `,` `;` `)` / "và": "11, 12 và 3 việc khác" thì "3" không phải mã. */
const CHAIN_AFTER = /^\s*(?:$|[,;)]|(?:và|va|and|&)(?:\s|$))/iu;

export interface ExpandedKeys {
  keys: string[];
  problems: string[];
  /** Tiền tố (`KYHOP-SUB-`) của mã cuối cùng — để câu sau (theo cặp) dùng tiếp cho số trần. */
  lastPrefix: string | null;
}

/**
 * Bung danh sách mã trong một đoạn: `KYHOP-SUB-11, 12, 15` → 11, 12, 15 cùng tiền tố mã đứng trước; `KYHOP-SUB-11..20`,
 * `11-20`, `11 đến 20`, `11 -> 20` → dải (gồm hai đầu). Số trần chỉ được nhận khi nối TRỰC TIẾP vào mục trước bằng `,` `;`
 * "và" (các số lạc như "trước ngày 15", "(sprint 5)", "3 việc khác" bị bỏ qua). Số trần ĐỨNG TRƯỚC mọi mã bị báo lỗi, không đoán. Dải ngược (20..11) và
 * quá `BULK_MAX_ITEMS` mã bị báo lỗi. Trùng mã chỉ giữ lần đầu (thứ tự xuất hiện).
 */
export function expandKeys(segment: string, startPrefix: string | null = null): ExpandedKeys {
  const keys: string[] = [];
  const seen = new Set<string>();
  const problems: string[] = [];
  let prefix = startPrefix;
  let prevEnd = -1;
  const reported = new Set<string>();
  for (const m of segment.matchAll(ITEM)) {
    const own = m[2];
    const from = Number(m[3]);
    const to = m[4] !== undefined ? Number(m[4]) : null;
    const itemStart = (m.index ?? 0) + m[1]!.length;
    const matchEnd = (m.index ?? 0) + m[0].length;
    const first = prevEnd < 0;
    const gapFrom = first ? 0 : prevEnd;
    const gap = segment.slice(gapFrom, itemStart);
    prevEnd = matchEnd;
    if (own) prefix = own.toUpperCase();
    else {
      // Số trần: chỉ nhận khi nối TRỰC TIẾP vào mục trước (hoặc đứng đầu đoạn khi đã có tiền tố từ vế trước).
      const chained = first ? gap.trim() === '' : CHAIN_GAP.test(normalizeVi(gap).trim());
      if (first && !prefix) {
        const msg = `Số ${m[3]} đứng trước mọi mã nên không biết thuộc tiền tố nào — hãy viết mã đầy đủ (vd DEMO-TASK-${m[3]}).`;
        if (!reported.has(msg)) problems.push(msg);
        reported.add(msg);
        continue;
      }
      if (!chained || !prefix || !CHAIN_AFTER.test(segment.slice(matchEnd))) continue; // số lạc ("trước ngày 15", "(sprint 5)")
    }
    if (to !== null && to < from) {
      problems.push(`Dải ${prefix}${from}..${to} bị ngược (số đầu lớn hơn số cuối).`);
      continue;
    }
    const last = to ?? from;
    if (last - from + 1 > BULK_MAX_ITEMS) {
      problems.push(
        `Dải ${prefix}${from}..${last} quá dài (tối đa ${BULK_MAX_ITEMS} việc mỗi lệnh).`,
      );
      continue;
    }
    for (let n = from; n <= last; n++) {
      const key = `${prefix}${n}`;
      if (guessIssueKey(key) && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  if (keys.length > BULK_MAX_ITEMS) {
    problems.push(
      `Quá ${BULK_MAX_ITEMS} việc trong một lệnh — hãy chia nhỏ (đang có ${keys.length}).`,
    );
    keys.length = BULK_MAX_ITEMS;
  }
  return { keys, problems, lastPrefix: prefix };
}

/** Đoạn có ít nhất một mã đầy đủ (`DEMO-TASK-12`) không. */
const hasFullKey = (s: string) => HAS_FULL_KEY.test(s);

/* ------------------------------ bộ lọc nhẹ ------------------------------ */

const KEY_WORD = /^[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z][A-Za-z0-9]*)*-\d+$/;
const NOT_PROJECT = new Set(['toi', 'minh', 'ban', 'nhom', 'du', 'an', 'cac', 'moi', 'tat', 'ca']);

/** Phân tích phần "việc nào" khi KHÔNG có danh sách mã: việc con của …, hoặc bộ lọc nhẹ. `null` = không nhận ra gì. */
export function parseFilter(what: string): IssueSelector | null {
  const ws = words(what);
  const f = ws.map((w) => w.fold);
  // "việc con của KEY" / "sub-task của KEY"
  for (let i = 0; i < ws.length; i++) {
    const n = phraseAt(ws, i, [
      'viec con cua',
      'cong viec con cua',
      'task con cua',
      'sub task cua',
      'subtask cua',
    ]);
    if (n && ws[i + n]) {
      const key = guessIssueKey(ws[i + n]!.raw.replace(/[?!.,;:)”"'\]]+$/g, ''));
      if (key) return { kind: 'children', parentKey: key };
    }
  }
  const filter: BulkFilter = {};
  const bracket = /\[[^\]]+\]/.exec(what);
  if (bracket) filter.titlePrefix = bracket[0];
  if (
    /(^| )(chua (giao|gan|co nguoi|co nguoi phu trach|duoc giao)|khong co nguoi (phu trach|nhan)|unassigned)( |$)/.test(
      f.join(' '),
    )
  )
    filter.unassigned = true;
  // Epic theo mã: "thuộc epic KEY", "trong epic KEY"
  for (let i = 0; i < ws.length - 1; i++) {
    if (f[i] === 'epic' && KEY_WORD.test(ws[i + 1]!.raw.replace(/[?!.,;:)”"'\]]+$/g, ''))) {
      filter.epicKey = guessIssueKey(ws[i + 1]!.raw.replace(/[?!.,;:)”"'\]]+$/g, '')) ?? undefined;
    }
  }
  // Loại việc
  const joined = ` ${f.join(' ')} `;
  if (/ (sub task|subtask|viec con|task con) /.test(joined)) filter.type = 'sub-task';
  else if (/ (bug|loi) /.test(joined)) filter.type = 'bug';
  else if (/ (story|user story) /.test(joined)) filter.type = 'story';
  else if (/ (task|cong viec) /.test(joined) && !/ (viec|cong viec) cua /.test(joined))
    filter.type = 'task';
  // Dự án: từ viết HOA (mã) sau "của / trong / thuộc / dự án"
  for (let i = 0; i < ws.length - 1; i++) {
    const lead = f[i] === 'cua' || f[i] === 'trong' || f[i] === 'thuoc' || f[i] === 'o';
    const afterDuAn = f[i] === 'du' && f[i + 1] === 'an' && ws[i + 2];
    const cand = afterDuAn ? ws[i + 2]! : lead ? ws[i + 1]! : null;
    if (!cand) continue;
    const raw = cand.raw.replace(/[?!.,;:)”"'\]]+$/g, '');
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(raw) || NOT_PROJECT.has(fold(raw))) continue;
    if (raw === raw.toUpperCase() && raw.length >= 2) {
      filter.project = raw;
      break;
    }
  }
  if (Object.keys(filter).length === 0) return null;
  return { kind: 'filter', filter };
}

/* ------------------------------ giao việc ------------------------------ */

const ASSIGN_VERBS = ['giao', 'gan', 'phan cong', 'assign'];
const ASSIGN_FILLERS = ['cac', 'nhung', 'may', 'tat ca', 'het'];
/**
 * "Tôi"/"mình" = người gõ. So khớp CÓ DẤU: "Minh" (không dấu) là tên người rất phổ biến nên KHÔNG được hiểu là "mình".
 * Gõ không dấu "toi" vẫn là chính mình ("Toi" không phải tên người).
 */
const SELF = new Set(['tôi', 'mình', 'tui', 'me', 'bản thân', 'toi', 'ban than']);

/** Số "việc" nên bị loại khỏi vế người ("giao KYHOP-1 cho tôi nhé"). */
const cleanPeople = (s: string): string[] => splitList(trimTail(s)).filter((p) => fold(p) !== '');

/** `true` khi tên người là chính người gõ ("tôi", "mình"). */
export const isSelfName = (name: string): boolean =>
  SELF.has(
    name
      .trim()
      .toLowerCase()
      .normalize('NFC')
      .replace(/[.,!?;:]+$/, ''),
  );

/**
 * "giao KYHOP-SUB-11, 12, 15 cho Thuỷ" · "giao KYHOP-SUB-11..20 cho Linh, Hà" · "giao việc con của KYHOP-TASK-12 cho An" ·
 * "giao các việc [Test] chưa giao của KYHOP cho Linh" · "giao KYHOP-SUB-11 cho Thuỷ, KYHOP-SUB-12 cho Linh" (theo cặp).
 * `null` nếu không phải lệnh giao (thiếu động từ, thiếu "cho", hoặc thiếu phần "việc nào").
 */
export function parseBulkAssign(text: string): BulkAssignIntent | null {
  const ws = words(text.trim());
  const src = text.trim();
  let i = skipPolite(ws);
  const verb = phraseAt(ws, i, ASSIGN_VERBS);
  if (!verb) return null;
  i += verb;
  for (;;) {
    const n = phraseAt(ws, i, ASSIGN_FILLERS);
    if (!n) break;
    i += n;
  }
  const body = src.slice(ws[i]?.start ?? src.length);
  const bws = words(body);
  // Từ "cho" thứ hai trở đi + có mã/số ⇒ KIỂU THEO CẶP ("A-1 cho Linh, A-2 cho An", "… và …", "… rồi …", dạng trộn). Không bao giờ
  // để một "cho" nằm lọt trong phần "việc nào" (sẽ giao nhầm người): hoặc tách thành cặp, hoặc báo lỗi.
  if (findAll(bws, ['cho']).length >= 2 && /\d/.test(body)) {
    const parsed = parsePairs(body, bws);
    return {
      kind: 'bulk-assign',
      selector: null,
      people: [],
      pairs: parsed.pairs,
      problems: parsed.problems,
    };
  }
  const c = findWord(bws, ['cho'], 0, true);
  if (c <= 0) return null; // "giao cho tôi" (không có phần việc) hoặc không có "cho"
  const what = sliceWords(body, bws, 0, c);
  const people = cleanPeople(sliceWords(body, bws, c + 1, bws.length));
  if (!what || people.length === 0) return null;
  const problems: string[] = [];
  let selector: IssueSelector | null = null;
  const children = hasFullKey(what) ? parseFilter(what) : null;
  // "các việc thuộc epic KEY chưa giao": mã Epic là phạm vi lọc, KHÔNG phải một việc cần giao.
  const epicScope = hasFullKey(what) ? parseFilter(what) : null;
  if (children?.kind === 'children') selector = children;
  else if (epicScope?.kind === 'filter' && epicScope.filter.epicKey) selector = epicScope;
  else if (hasFullKey(what)) {
    const ex = expandKeys(what);
    problems.push(...ex.problems);
    selector = ex.keys.length > 0 ? { kind: 'keys', keys: ex.keys } : null;
  } else {
    selector = parseFilter(what);
    if (!selector)
      problems.push(
        'Mình chưa hiểu bạn muốn giao những việc nào — hãy nêu mã (vd KYHOP-SUB-11, 12) hoặc bộ lọc như “các việc [Test] chưa giao của KYHOP”.',
      );
  }
  return { kind: 'bulk-assign', selector, people, pairs: null, problems };
}

/** Mọi vị trí (chỉ số từ) của từ có `fold` thuộc `set`, không nằm trong `[...]`. */
function findAll(ws: Word[], set: readonly string[]): number[] {
  const out: number[] = [];
  let depth = 0;
  for (const [i, w] of ws.entries()) {
    depth += (w.raw.match(/\[/g)?.length ?? 0) - (w.raw.match(/\]/g)?.length ?? 0);
    if (depth <= 0 && set.includes(w.fold)) out.push(i);
  }
  return out;
}

/** Dấu nối giữa các cặp: `,` `;` `&` "và" "rồi" "sau đó". */
const PAIR_SEP = /\s*[,;&]\s*|\s+(?:và|va|and|rồi|roi|sau đó|sau do)\s+/giu;
const PAIR_FIX =
  'Mình chưa hiểu cặp việc – người. Hãy viết từng cặp “KYHOP-1 cho Linh”, cách nhau bằng dấu phẩy, và mỗi việc chỉ một người.';

/** Cắt `text` theo PAIR_SEP, giữ vị trí bắt đầu của từng mảnh. */
function pieces(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let last = 0;
  for (const m of text.matchAll(PAIR_SEP)) {
    out.push({ text: text.slice(last, m.index), start: last });
    last = (m.index ?? 0) + m[0].length;
  }
  out.push({ text: text.slice(last), start: last });
  return out.filter((x) => x.text.trim() !== '');
}

/**
 * Kiểu theo cặp với ≥ 2 từ "cho". Phần giữa hai "cho" = [người của cặp trước] [dấu nối] [việc của cặp sau]: việc của cặp sau
 * bắt đầu từ mảnh đầu tiên có số/mã. Việc đứng liền nhau không có "cho" ("A-11, A-12 cho An, A-13 cho Linh") cùng thuộc người
 * của "cho" kế tiếp. Mỗi cặp đúng MỘT người; sai cấu trúc → pairs null + lỗi (KHÔNG đoán).
 */
function parsePairs(
  body: string,
  bws: Word[],
): { pairs: { key: string; person: string }[] | null; problems: string[] } {
  const fail = (extra?: string) => ({ pairs: null, problems: [extra ?? PAIR_FIX] });
  const cho = findAll(bws, ['cho']);
  const lefts: string[] = [sliceWords(body, bws, 0, cho[0]!)];
  const persons: string[] = [];
  for (const [k, ci] of cho.entries()) {
    const last = k === cho.length - 1;
    const text = sliceWords(body, bws, ci + 1, last ? bws.length : cho[k + 1]!);
    if (last) {
      const ps = pieces(trimTail(text));
      if (ps.length !== 1) return fail();
      persons.push(ps[0]!.text.trim());
      continue;
    }
    const ps = pieces(text);
    const firstLeft = ps.findIndex((x) => /\d/.test(x.text));
    if (firstLeft !== 1) return fail(); // đúng một người rồi tới việc kế tiếp
    persons.push(ps[0]!.text.trim());
    lefts.push(text.slice(ps[firstLeft]!.start));
  }
  const pairs: { key: string; person: string }[] = [];
  const problems: string[] = [];
  let prefix: string | null = null;
  for (const [k, left] of lefts.entries()) {
    const ex = expandKeys(left, prefix);
    prefix = ex.lastPrefix;
    problems.push(...ex.problems);
    if (ex.keys.length === 0) return fail();
    for (const key of ex.keys) pairs.push({ key, person: persons[k]! });
  }
  if (pairs.length > BULK_MAX_ITEMS) {
    problems.push(`Quá ${BULK_MAX_ITEMS} việc trong một lệnh — hãy chia nhỏ.`);
    return { pairs: pairs.slice(0, BULK_MAX_ITEMS), problems };
  }
  return { pairs, problems };
}

/* ------------------------------ thêm / gỡ thành viên ------------------------------ */

/** "thêm / add / mời" ("mời" CÓ DẤU: "mới" và "mọi" gấp về cùng "moi"; "đưa" không phải động từ thêm thành viên — "đưa KYHOP-12 vào sprint"). */
const ADD_VERBS = ['them', 'add'];
const isMoi = (w: Word | undefined): boolean =>
  !!w &&
  w.raw
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:]+$/, '') === 'mời';

/**
 * Vế "người" KHÔNG phải tên người: danh từ chung / đối tượng khác của "thêm … vào …" ("thêm bình luận vào KYHOP-12",
 * "thêm thành viên vào dự án X", "thêm mọi người vào X"). Gặp một mục như vậy thì KHÔNG nhận lệnh (nhường ý định cũ).
 */
const GENERIC_WHO = new Set([
  'binh luan',
  'comment',
  'label',
  'column',
  'thanh vien',
  'moi nguoi',
  'tat ca',
  'nguoi dung',
  'user',
  'users',
  'member',
  'members',
  'file',
  'tep',
  'tai lieu',
  'du an',
  'viec',
  'task',
  'bug',
  'issue',
  'sprint',
  'epic',
  'board',
  'cong viec',
  'tai khoan',
]);
/** Vế "đích" bắt đầu bằng từ này không phải dự án ("vào sprint 5", "vào hệ thống", "vào board X"). */
const NOT_A_PROJECT = new Set([
  'sprint',
  'board',
  'he thong',
  'backlog',
  'epic',
  'label',
  'bo loc',
  'filter',
  'dashboard',
  'phien ban',
  'version',
]);
/** Danh từ chung CÓ DẤU (không gấp dấu được vì "Nhân", "Bằng", "Cốt" là tên người): nhãn, cột, bảng. */
const ACCENTED_GENERIC = new Set(['nhãn', 'cột', 'bảng']);
const startsGeneric = (s: string, set: Set<string>): boolean => {
  const rawFirst = s.trim().split(/\s+/)[0]?.toLowerCase().normalize('NFC') ?? '';
  if (ACCENTED_GENERIC.has(rawFirst)) return true;
  const f = fold(s).replace(/\s+/g, ' ').trim();
  if (set.has(f)) return true;
  const first = f.split(' ')[0] ?? '';
  const first2 = f.split(' ').slice(0, 2).join(' ');
  return set.has(first) || set.has(first2);
};
/** Mục "người" hợp lệ: không phải mã việc đầy đủ, không phải danh từ chung. */
const badWho = (item: string): boolean =>
  KEY_WORD.test(item.trim()) || startsGeneric(item, GENERIC_WHO);
/** Mục "đích" hợp lệ: không phải mã việc, không phải sprint/board/hệ thống… */
const badTarget = (item: string): boolean =>
  KEY_WORD.test(item.trim()) || startsGeneric(item, NOT_A_PROJECT);
const REMOVE_VERBS = ['go', 'xoa', 'bo', 'loai', 'remove'];
const DU_AN_WORDS = ['cac du an', 'du an', 'cac project', 'project', 'moi du an'];

/**
 * "mọi dự án nhóm Thanh Hóa của tôi" / "nhóm Thanh Hóa của tôi" / "dự án nhóm Thanh Hóa" → tên nhóm (nguyên văn).
 * `explicit` = nói rõ là nhóm dự án (có "của tôi/mình" hoặc "dự án" đứng trước); trần "nhóm QA" có thể là team của tổ chức.
 */
function groupOf(part: string): { name: string; explicit: boolean } | null {
  const ws = words(part);
  let i = 0;
  for (;;) {
    const n = phraseAt(ws, i, [
      'moi du an',
      'tat ca du an',
      'toan bo du an',
      'cac du an',
      'du an',
      'moi',
    ]);
    if (!n) break;
    i += n;
  }
  if (ws[i]?.fold !== 'nhom') return null;
  let end = ws.length;
  // bỏ "của tôi / của mình" ở cuối
  const tail = ws
    .slice(-2)
    .map((w) => w.fold)
    .join(' ');
  if (tail === 'cua toi' || tail === 'cua minh') end -= 2;
  const name = sliceWords(part, ws, i + 1, end);
  return name ? { name, explicit: end !== ws.length || i > 0 } : null;
}

function parseTargets(where: string): { targets: ProjectTargets; problems: string[] } {
  const problems: string[] = [];
  const refs: string[] = [];
  let group: string | null = null;
  let loose = false;
  for (const part of splitList(where)) {
    const g = groupOf(part);
    if (g) {
      if (group) problems.push('Mỗi lệnh chỉ dùng được MỘT nhóm dự án.');
      else {
        group = g.name;
        loose = !g.explicit;
      }
      continue;
    }
    // bỏ chữ "dự án"/"project" đứng đầu: "dự án KYHOP" → "KYHOP"
    const ws = words(part);
    const n = phraseAt(ws, 0, DU_AN_WORDS);
    const ref = trimTail(sliceWords(part, ws, n, ws.length));
    if (ref) refs.push(ref);
  }
  return { targets: { refs, group, ...(loose ? { groupLoose: true } : {}) }, problems };
}

/** Tách "vai trò Tester" ở cuối vế dự án. Trả `{ where, role }` (role null nếu không có). */
function splitRole(rest: string): { where: string; role: string | null } {
  const ws = words(rest);
  for (let i = 0; i < ws.length; i++) {
    const n = phraseAt(ws, i, ['voi vai tro', 'vai tro', 'voi role', 'role', 'la']);
    // "là Tester": chỉ khi "là" không đứng đầu vế dự án và vai trò ngắn (≤ 3 từ).
    if (n && ws[i]!.fold === 'la' && (i === 0 || ws.length - i - n > 3)) continue;
    if (n && ws[i + n]) {
      const where = rest.slice(0, ws[i]!.start).trim();
      const role = trimTail(rest.slice(ws[i + n]!.start)).replace(/^["“'](.*)["”']$/, '$1');
      return { where, role: role || null };
    }
  }
  return { where: rest, role: null };
}

/** Phân người/team: "Nhóm QA" → team; còn lại là người. */
function splitWho(who: string): { people: string[]; teams: string[] } {
  const people: string[] = [];
  const teams: string[] = [];
  for (const item of splitList(trimTail(who))) {
    const ws = words(item);
    if (ws[0]?.fold === 'nhom' || ws[0]?.fold === 'team') {
      const name = sliceWords(item, ws, 1, ws.length);
      if (name) teams.push(name);
    } else people.push(item);
  }
  return { people, teams };
}

/**
 * "thêm Linh, Thuỷ vào KYHOP, LLTT với vai trò Tester" · "thêm Nhóm QA vào GSDA vai trò Tester" ·
 * "thêm Hương vào mọi dự án nhóm Thanh Hóa của tôi". `null` nếu không có "vào" hoặc thiếu người / dự án.
 */
export function parseBulkAddMember(text: string): BulkAddMemberIntent | null {
  const src = text.trim();
  const ws = words(src);
  let i = skipPolite(ws);
  const verb = phraseAt(ws, i, ADD_VERBS) || (isMoi(ws[i]) ? 1 : 0);
  if (!verb) return null;
  i += verb;
  i += phraseAt(ws, i, ['them', 'cac', 'nhung']);
  const v = findWord(ws, ['vao'], i);
  if (v <= i) return null;
  const who = sliceWords(src, ws, i, v);
  const { where, role } = splitRole(sliceWords(src, ws, v + 1, ws.length));
  const { people, teams } = splitWho(who);
  const { targets, problems } = parseTargets(where);
  if (people.length + teams.length === 0 || (targets.refs.length === 0 && !targets.group))
    return null;
  if (people.some(badWho) || targets.refs.some(badTarget)) return null;
  return { kind: 'bulk-add-member', people, teams, targets, role, problems };
}

/** "gỡ Linh khỏi KYHOP, LLTT" · "xoá Linh, Thuỷ khỏi dự án KYHOP" · "bỏ An khỏi mọi dự án nhóm Hà Nội của tôi". */
export function parseBulkRemoveMember(text: string): BulkRemoveMemberIntent | null {
  const src = text.trim();
  const ws = words(src);
  let i = skipPolite(ws);
  const verb = phraseAt(ws, i, REMOVE_VERBS);
  if (!verb) return null;
  i += verb;
  i += phraseAt(ws, i, ['cac', 'nhung']);
  const k = findWord(ws, ['khoi'], i);
  if (k <= i) return null;
  // "ra khỏi": bỏ chữ "ra" cuối vế người
  const whoEnd = ws[k - 1]?.fold === 'ra' ? k - 1 : k;
  const who = sliceWords(src, ws, i, whoEnd);
  const people = splitList(trimTail(who));
  const { targets, problems } = parseTargets(sliceWords(src, ws, k + 1, ws.length));
  if (people.length === 0 || (targets.refs.length === 0 && !targets.group)) return null;
  if (people.some(badWho) || targets.refs.some(badTarget)) return null;
  return { kind: 'bulk-remove-member', people, targets, problems };
}

/** Thử cả ba lệnh hàng loạt; `null` = không phải lệnh hàng loạt. */
export function parseBulkCommand(text: string): BulkIntent | null {
  const intent = parseBulkAssign(text) ?? parseBulkAddMember(text) ?? parseBulkRemoveMember(text);
  return intent ? { ...intent, raw: text } : null;
}
