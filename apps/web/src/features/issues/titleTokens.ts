/* Gõ nhanh trong tiêu đề: !ưu-tiên @người #sprint ~điểm ^hạn — parse + gợi ý + chip xác nhận. */

export function normalize(s: string): string {
  // Hạ chữ thường TRƯỚC khi bỏ dấu: 'Đ' hoa chỉ thành 'đ' sau toLowerCase, rồi mới đổi sang 'd'.
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd');
}
const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function parseDue(val: string): string | undefined {
  const v = normalize(val);
  const at17 = (d: Date) => {
    d.setHours(17, 0, 0, 0);
    return toLocal(d);
  };
  if (v === 'nay' || v === 'homnay') return at17(new Date());
  if (v === 'mai' || v === 'ngaymai') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return at17(d);
  }
  if (v === 'mot' || v === 'ngaymot' || v === 'kia') {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return at17(d);
  }
  const off = /^(\d+)(d|ng|ngay|w|tuan|m|thang)$/.exec(v);
  if (off) {
    const n = Number(off[1]);
    const unit = off[2]!;
    const d = new Date();
    if (unit === 'w' || unit === 'tuan') d.setDate(d.getDate() + n * 7);
    else if (unit === 'm' || unit === 'thang') d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n);
    return at17(d);
  }
  const wd: Record<string, number> = {
    t2: 1,
    t3: 2,
    t4: 3,
    t5: 4,
    t6: 5,
    t7: 6,
    cn: 0,
    chunhat: 0,
  };
  if (v in wd) {
    const d = new Date();
    let add = (wd[v]! - d.getDay() + 7) % 7;
    if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
    return at17(d);
  }
  const md = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(val);
  if (md) {
    let year = md[3] ? Number(md[3]) : new Date().getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, Number(md[2]) - 1, Number(md[1]), 17, 0, 0, 0);
    if (!Number.isNaN(d.getTime())) return toLocal(d);
  }
  return undefined;
}

export interface TokenCtx {
  priorities: {
    id: string;
    name: string;
    color?: string | null;
    rank?: number;
    isDefault?: boolean;
  }[];
  users: { id: string; displayName: string; avatarUrl?: string | null }[];
  sprints: { id: string; name: string; state: string }[];
}
export interface TokenResult {
  clean: string;
  priorityId?: string;
  assigneeId?: string;
  sprintId?: string;
  points?: number;
  dueLocal?: string;
}

interface Named {
  id: string;
  name: string;
}

/** Khớp 1 từ: bằng đúng > bắt đầu bằng > chứa (để "!high" ra High chứ không phải Highest). */
export function bestMatch<T>(
  items: T[],
  val: string,
  key: (t: T) => string,
  strip = false,
): T | undefined {
  const norm = (s: string) => (strip ? normalize(s).replace(/\s/g, '') : normalize(s));
  const nv = norm(val);
  if (!nv) return undefined;
  return (
    items.find((i) => norm(key(i)) === nv) ??
    items.find((i) => norm(key(i)).startsWith(nv)) ??
    items.find((i) => norm(key(i)).includes(nv))
  );
}

/**
 * Độ dài (số ký tự gốc) của tiền tố `rest` khớp CHÍNH XÁC tên `name` (bỏ dấu, không phân biệt hoa/thường).
 * Cho phép tên có khoảng trắng (vd "Bình (BA)", "Sprint 3 — QT"). Trả null nếu không khớp.
 */
function prefixLenOfName(rest: string, name: string): number | null {
  const target = normalize(name);
  if (!target) return null;
  for (let k = 1; k <= rest.length; k++) {
    const acc = normalize(rest.slice(0, k));
    if (acc === target) return k;
    if (acc.length > target.length) return null; // vượt quá → không thể khớp
  }
  return null;
}

/** Khớp tham lam theo TÊN ĐẦY ĐỦ: chọn ứng viên có tên dài nhất là tiền tố (kết thúc ở ranh giới từ) của `rest`. */
function greedyName(rest: string, list: Named[]): { id: string; length: number } | null {
  let best: { id: string; length: number } | null = null;
  for (const c of list) {
    const len = prefixLenOfName(rest, c.name);
    if (len == null) continue;
    const after = rest[len];
    if (after === undefined || /\s/.test(after)) {
      if (!best || len > best.length) best = { id: c.id, length: len };
    }
  }
  return best;
}

/* ---------- Bí danh ưu tiên tiếng Việt (khớp theo bậc, không cứng theo id) ---------- */

type Tier = 'top' | 'high' | 'mid' | 'low' | 'bottom';
type PriorityItem = TokenCtx['priorities'][number];

/** `phrase` đã bỏ dấu (so khớp), `pretty` hiện ở gợi ý. Khai báo theo thứ tự hiển thị. */
const ALIAS_LIST: { phrase: string; pretty: string; tier: Tier }[] = [
  { phrase: 'khan', pretty: 'khẩn', tier: 'top' },
  { phrase: 'khan cap', pretty: 'khẩn cấp', tier: 'top' },
  { phrase: 'rat cao', pretty: 'rất cao', tier: 'top' },
  { phrase: 'cao', pretty: 'cao', tier: 'high' },
  { phrase: 'trung binh', pretty: 'trung bình', tier: 'mid' },
  { phrase: 'tb', pretty: 'tb', tier: 'mid' },
  { phrase: 'thap', pretty: 'thấp', tier: 'low' },
  { phrase: 'rat thap', pretty: 'rất thấp', tier: 'bottom' },
];
/** Cụm dài thử trước ("rất thấp" trước "thấp"). */
const ALIASES = [...ALIAS_LIST].sort((a, b) => b.phrase.length - a.phrase.length);
const TIER_NAMES: Record<Tier, string[]> = {
  top: ['highest', 'urgent', 'critical', 'blocker'],
  high: ['high', 'major'],
  mid: ['medium', 'normal'],
  low: ['low', 'minor'],
  bottom: ['lowest', 'trivial'],
};

/** Bậc → mức ưu tiên: tên quen thuộc; hoặc đúng ≥ 5 mức thì theo rank; còn lại không đoán. */
function resolveTier(tier: Tier, ps: PriorityItem[]): PriorityItem | undefined {
  const byName = ps.find((p) => TIER_NAMES[tier].includes(normalize(p.name)));
  if (byName) return byName;
  if (ps.length < 5) return tier === 'mid' ? ps.find((p) => p.isDefault) : undefined;
  const s = [...ps].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  const n = s.length;
  return {
    top: s[0],
    high: s[1],
    mid: ps.find((p) => p.isDefault) ?? s[Math.floor(n / 2)],
    low: s[n - 2],
    bottom: s[n - 1],
  }[tier];
}

function matchAlias(rest: string, ps: PriorityItem[]): { id: string; length: number } | null {
  for (const a of ALIASES) {
    const len = prefixLenOfName(rest, a.phrase);
    if (len == null) continue;
    const after = rest[len];
    if (after !== undefined && !/\s/.test(after)) continue; // phải đứng trọn từ
    const p = resolveTier(a.tier, ps);
    if (p) return { id: p.id, length: len };
  }
  return null;
}

/** Khớp 1 token đứng sau symbol. Trả giá trị + số ký tự (sau symbol) đã tiêu thụ, hoặc null nếu không khớp. */
function matchToken(
  sym: string,
  rest: string,
  lists: { priorities: Named[]; users: Named[]; sprints: Named[] },
  prios: PriorityItem[],
): { id?: string; points?: number; due?: string; length: number } | null {
  if (sym === '~') {
    const m = /^(\d+)/.exec(rest);
    return m ? { points: Number(m[1]), length: m[1]!.length } : null;
  }
  if (sym === '^') {
    const m = /^(\S+)/.exec(rest);
    if (m) {
      const due = parseDue(m[1]!);
      if (due) return { due, length: m[1]!.length };
    }
    return null;
  }
  const list = sym === '!' ? lists.priorities : sym === '@' ? lists.users : lists.sprints;
  // 1) Tên đầy đủ (đã chọn từ gợi ý → có khoảng trắng).
  const full = greedyName(rest, list);
  if (full) return { id: full.id, length: full.length };
  // 2) Bí danh tiếng Việt cho ưu tiên (!cao, !khẩn, !trung bình…).
  if (sym === '!') {
    const al = matchAlias(rest, prios);
    if (al) return { id: al.id, length: al.length };
  }
  // 3) Viết tắt 1 từ (người dùng tự gõ, chưa chọn).
  const w = /^(\S+)/.exec(rest);
  if (w) {
    const hit = bestMatch(list, w[1]!, (x) => x.name, sym === '#');
    if (hit) return { id: hit.id, length: w[1]!.length };
  }
  return null;
}

/** Loại token — dùng để tô sáng inline & phân nhánh khi áp trường. */
export type TokenKind = 'assignee' | 'priority' | 'sprint' | 'points' | 'due';

const SYM_KIND: Record<string, TokenKind> = {
  '!': 'priority',
  '@': 'assignee',
  '#': 'sprint',
  '~': 'points',
  '^': 'due',
};

interface TokenSpan {
  start: number;
  end: number;
  kind: TokenKind;
}

export interface UnmatchedToken {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

/** Quét 1 lần: vừa suy ra các trường (result), vừa ghi lại các đoạn token khớp (spans, gồm cả symbol) và token không khớp. */
function scanTokens(
  text: string,
  ctx: TokenCtx,
): { result: TokenResult; spans: TokenSpan[]; unmatched: UnmatchedToken[] } {
  const res: TokenResult = { clean: text };
  const spans: TokenSpan[] = [];
  const unmatched: UnmatchedToken[] = [];
  const lists = {
    priorities: ctx.priorities.map((p) => ({ id: p.id, name: p.name })),
    users: ctx.users.map((u) => ({ id: u.id, name: u.displayName })),
    sprints: ctx.sprints
      .filter((s) => s.state !== 'CLOSED')
      .map((s) => ({ id: s.id, name: s.name })),
  };
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    const boundary = i === 0 || /\s/.test(text[i - 1]!);
    if (boundary && (ch === '!' || ch === '@' || ch === '#' || ch === '~' || ch === '^')) {
      const m = matchToken(ch, text.slice(i + 1), lists, ctx.priorities);
      if (m) {
        if (ch === '!' && m.id) res.priorityId = m.id;
        else if (ch === '@' && m.id) res.assigneeId = m.id;
        else if (ch === '#' && m.id) res.sprintId = m.id;
        else if (ch === '~' && m.points != null) res.points = m.points;
        else if (ch === '^' && m.due) res.dueLocal = m.due;
        const end = i + 1 + m.length;
        spans.push({ start: i, end, kind: SYM_KIND[ch]! });
        i = end; // bỏ qua symbol + phần đã tiêu thụ
        continue;
      }
      // Không khớp: ghi lại để UI cảnh báo (tiêu đề vẫn giữ nguyên chữ). `#123` là tham chiếu, không phải sprint.
      const w = /^\S+/.exec(text.slice(i + 1));
      if (w && !(ch === '#' && /^\d+$/.test(w[0]))) {
        unmatched.push({
          kind: SYM_KIND[ch]!,
          text: text.slice(i, i + 1 + w[0].length),
          start: i,
          end: i + 1 + w[0].length,
        });
      }
    }
    out += ch;
    i += 1;
  }
  res.clean = out.replace(/\s{2,}/g, ' ').trim();
  return { result: res, spans, unmatched };
}

/** Tách token khỏi tiêu đề & ánh xạ sang các trường. Token không khớp thì giữ nguyên trong tiêu đề. */
export function parseTitleTokens(text: string, ctx: TokenCtx): TokenResult {
  return scanTokens(text, ctx).result;
}

/**
 * Token (ký hiệu đứng đầu từ + ≥ 1 ký tự) KHÔNG khớp. Bỏ `#<số>` (tham chiếu `#123`);
 * `skipTail` bỏ token kết thúc đúng cuối chuỗi (người dùng còn đang gõ).
 */
export function unmatchedTokens(
  text: string,
  ctx: TokenCtx,
  opts: { skipTail?: boolean } = {},
): UnmatchedToken[] {
  const { unmatched } = scanTokens(text, ctx);
  return opts.skipTail ? unmatched.filter((t) => t.end !== text.length) : unmatched;
}

/** Bỏ từ cuối nếu nó bắt đầu bằng `! @ # ~ ^` và chuỗi không kết thúc bằng khoảng trắng (token đang gõ dở). */
export function stripPartialTail(text: string): string {
  if (/\s$/.test(text)) return text;
  const m = /(^|\s)[!@#~^]\S*$/.exec(text);
  return m ? text.slice(0, m.index).trimEnd() : text;
}

const TOKEN_FIELDS = ['priorityId', 'assigneeId', 'sprintId', 'points', 'dueLocal'] as const;

/** Các trường token có giá trị mới khác lần trước. Gỡ token (giá trị biến mất) KHÔNG được báo — ô giữ nguyên. */
export function changedTokenFields(
  prev: TokenResult,
  next: TokenResult,
): Partial<Omit<TokenResult, 'clean'>> {
  const out: Record<string, string | number> = {};
  for (const k of TOKEN_FIELDS) {
    const v = next[k];
    if (v !== undefined && v !== prev[k]) out[k] = v;
  }
  return out;
}

export interface DisplaySegment {
  text: string;
  kind: TokenKind | 'unknown' | null;
}

/**
 * Chia chuỗi thành các đoạn để tô sáng inline: token đã nhận (kind), token không nhận ra ('unknown')
 * xen kẽ chữ thường (null). Mặc định bỏ qua token đang gõ dở ở cuối (`skipTail`).
 */
export function tokenSegments(
  text: string,
  ctx: TokenCtx,
  opts: { skipTail?: boolean } = { skipTail: true },
): DisplaySegment[] {
  const { spans, unmatched } = scanTokens(text, ctx);
  const marks: { start: number; end: number; kind: DisplaySegment['kind'] }[] = [
    ...spans,
    ...(opts.skipTail ? unmatched.filter((t) => t.end !== text.length) : unmatched).map((t) => ({
      start: t.start,
      end: t.end,
      kind: 'unknown' as const,
    })),
  ].sort((a, b) => a.start - b.start);
  const out: DisplaySegment[] = [];
  let pos = 0;
  for (const s of marks) {
    if (s.start > pos) out.push({ text: text.slice(pos, s.start), kind: null });
    out.push({ text: text.slice(s.start, s.end), kind: s.kind });
    pos = s.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), kind: null });
  return out;
}

/* ---------- Gợi ý (autocomplete) cho token đang gõ ---------- */

export interface ActiveToken {
  sym: string;
  partial: string;
  start: number;
}

/** Token đang gõ ngay trước con trỏ (nếu có): symbol đứng đầu từ/khoảng trắng, phần gõ dở chưa có khoảng trắng. */
export function activeTokenAt(value: string, caret: number): ActiveToken | null {
  const head = value.slice(0, caret);
  const m = /(^|\s)([!@#~^])([^\s]*)$/.exec(head);
  if (!m) return null;
  return { sym: m[2]!, partial: m[3] ?? '', start: caret - (m[3]?.length ?? 0) - 1 };
}

export interface Suggestion {
  id: string;
  label: string;
  hint?: string;
  insert: string;
}

/** Danh sách gợi ý cho token đang gõ (chỉ !/@/# có danh sách). Chèn TÊN ĐẦY ĐỦ khi chọn. */
export function suggestFor(sym: string, partial: string, ctx: TokenCtx): Suggestion[] {
  const nv = normalize(partial);
  const match = (name: string, strip = false) => {
    const n = strip ? normalize(name).replace(/\s/g, '') : normalize(name);
    return !nv || n.includes(strip ? nv.replace(/\s/g, '') : nv);
  };
  if (sym === '!') {
    const aliasesOf = (p: PriorityItem) =>
      ALIAS_LIST.filter((a) => resolveTier(a.tier, ctx.priorities)?.id === p.id);
    // includes để không sót, nhưng tên/bí danh bắt đầu bằng phần đã gõ lên trước ("ca" → Cao trước Khẩn cấp).
    const starts = (p: PriorityItem) =>
      normalize(p.name).startsWith(nv) || aliasesOf(p).some((a) => a.phrase.startsWith(nv));
    return ctx.priorities
      .filter((p) => match(p.name) || aliasesOf(p).some((a) => a.phrase.includes(nv)))
      .map((p, i) => ({ p, i, rank: starts(p) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .slice(0, 6)
      .map(({ p }) => {
        const al = aliasesOf(p).map((a) => a.pretty);
        return {
          id: p.id,
          label: p.name,
          hint: al.length > 0 ? al.join(' · ') : undefined,
          insert: `!${p.name}`,
        };
      });
  }
  if (sym === '@') {
    return ctx.users
      .filter((u) => match(u.displayName))
      .slice(0, 6)
      .map((u) => ({ id: u.id, label: u.displayName, insert: `@${u.displayName}` }));
  }
  if (sym === '#') {
    return ctx.sprints
      .filter((s) => s.state !== 'CLOSED')
      .filter((s) => match(s.name, true))
      .slice(0, 6)
      .map((s) => ({
        id: s.id,
        label: s.name,
        hint: s.state === 'ACTIVE' ? 'đang chạy' : undefined,
        insert: `#${s.name}`,
      }));
  }
  return [];
}
