import { normalizeVi } from '@/lib/text';

/**
 * Khớp TÊN người dùng gõ với dữ liệu thật cho các lệnh hàng loạt — thuần hàm, không dấu / không phân biệt hoa thường
 * (`normalizeVi`). Nguyên tắc an toàn: chỉ trả `ok` khi chỉ có MỘT ứng viên; từ hai ứng viên trở lên là `ambiguous` để thẻ
 * xem trước BẮT người dùng chọn (không bao giờ đoán).
 */
export type Resolution<T> =
  | { status: 'ok'; query: string; value: T }
  | { status: 'ambiguous'; query: string; options: T[] }
  | { status: 'none'; query: string };

export interface PersonRef {
  id: string;
  displayName: string;
  email?: string | null;
}
export interface ProjectRef {
  id: string;
  key: string;
  name: string;
}
export interface TeamRef {
  id: string;
  name: string;
  /** Mã ngắn của team (tuỳ chọn). */
  key?: string | null;
  members: PersonRef[];
}
/** Nhóm dự án CÁ NHÂN của người gõ (`GET /programs` chỉ trả nhóm của chính họ). */
export interface GroupRef {
  id: string;
  name: string;
  projects: Array<{ id: string; key: string; name: string; isArchived?: boolean }>;
}
export interface RoleRef {
  id: string;
  name: string;
}

const tokensOf = (s: string): string[] =>
  normalizeVi(s)
    .split(/[\s.,;:()"'“”‘’@]+/)
    .filter(Boolean);
const flat = (s: string): string => tokensOf(s).join(' ');

interface Candidate<T> {
  item: T;
  /** Chuỗi khớp NGUYÊN (đã chuẩn hoá): tên đầy đủ, email, mã… */
  exact: string[];
  /** Chữ tách từ để khớp từng từ (tên). */
  words: string[];
}

/**
 * Bậc 1 khớp nguyên (tên đầy đủ/email/mã) · bậc 2 mọi từ người gõ là TỪ NGUYÊN của tên · bậc 3 mọi từ là TIỀN TỐ của một từ.
 * Dừng ở bậc đầu tiên có ứng viên; ≥ 2 ứng viên cùng bậc → mơ hồ.
 */
function matchTiers<T>(
  query: string,
  cands: Candidate<T>[],
  same: (a: T, b: T) => boolean,
): Resolution<T> {
  const q = query.trim();
  const qFlat = flat(q);
  const qTokens = tokensOf(q);
  const empty: Resolution<T> = { status: 'none', query };
  if (qTokens.length === 0) return empty;
  const pick = (hits: T[]): Resolution<T> | null => {
    const uniq = hits.filter((h, i) => hits.findIndex((o) => same(o, h)) === i);
    if (uniq.length === 0) return null;
    return uniq.length === 1
      ? { status: 'ok', query, value: uniq[0]! }
      : { status: 'ambiguous', query, options: uniq };
  };
  const emailQuery = q.includes('@') ? q.toLowerCase() : null;
  const tier1 = cands.filter((c) =>
    emailQuery ? c.exact.includes(emailQuery) : c.exact.includes(qFlat),
  );
  const r1 = pick(tier1.map((c) => c.item));
  if (r1) return r1;
  const r2 = pick(
    cands.filter((c) => qTokens.every((t) => c.words.includes(t))).map((c) => c.item),
  );
  if (r2) return r2;
  const r3 = pick(
    cands
      .filter((c) => qTokens.every((t) => c.words.some((w) => w.startsWith(t))))
      .map((c) => c.item),
  );
  return r3 ?? empty;
}

export function resolvePerson(query: string, people: readonly PersonRef[]): Resolution<PersonRef> {
  return matchTiers(
    query,
    people.map((p) => ({
      item: p,
      exact: [flat(p.displayName), ...(p.email ? [p.email.toLowerCase()] : [])],
      words: tokensOf(p.displayName),
    })),
    (a, b) => a.id === b.id,
  );
}

export function resolveProject(
  query: string,
  projects: readonly ProjectRef[],
): Resolution<ProjectRef> {
  return matchTiers(
    query,
    projects.map((p) => ({
      item: p,
      exact: [flat(p.key), flat(p.name)],
      words: [flat(p.key), ...tokensOf(p.name)],
    })),
    (a, b) => a.id === b.id,
  );
}

export function resolveTeam(query: string, teams: readonly TeamRef[]): Resolution<TeamRef> {
  return matchTiers(
    query,
    teams.map((t) => ({
      item: t,
      exact: [flat(t.name), ...(t.key ? [flat(t.key)] : [])],
      words: tokensOf(t.name),
    })),
    (a, b) => a.id === b.id,
  );
}

export function resolveGroup(query: string, groups: readonly GroupRef[]): Resolution<GroupRef> {
  return matchTiers(
    query,
    groups.map((g) => ({ item: g, exact: [flat(g.name)], words: tokensOf(g.name) })),
    (a, b) => a.id === b.id,
  );
}

export function resolveRole(query: string, roles: readonly RoleRef[]): Resolution<RoleRef> {
  return matchTiers(
    query,
    roles.map((r) => ({ item: r, exact: [flat(r.name)], words: tokensOf(r.name) })),
    (a, b) => a.id === b.id,
  );
}

/** Khớp nhiều tên cùng lúc; cùng MỘT người/dự án được gọi hai lần chỉ giữ lần đầu (`ok` trùng bị bỏ, không bị cộng đôi). */
export function resolveMany<T>(
  queries: readonly string[],
  resolve: (q: string) => Resolution<T>,
  idOf: (v: T) => string,
): Resolution<T>[] {
  const seen = new Set<string>();
  const out: Resolution<T>[] = [];
  for (const q of queries) {
    const r = resolve(q);
    if (r.status === 'ok') {
      const id = idOf(r.value);
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(r);
  }
  return out;
}

/* ------------------------------ bộ lọc → JQL ------------------------------ */

/** Chuỗi JQL trong ngoặc kép: bỏ `"` và `\` (không thoát được trong ngữ pháp rút gọn) nên không thể phá câu lệnh. */
const q = (s: string): string => `"${s.replace(/["\\]/g, ' ').trim()}"`;

export interface FilterJqlInput {
  projectKey: string;
  /** Tên loại việc THẬT của tổ chức (từ meta dự án); thiếu thì dùng tên chuẩn. */
  typeName?: string;
  unassigned?: boolean;
  /** Từ khoá thu hẹp theo tiêu đề (`summary ~`), phần "bắt đầu bằng" lọc tiếp phía trình duyệt. */
  titleContains?: string;
}

/**
 * Bộ lọc nhẹ → JQL hiển thị trên thẻ (và chạy khi không có điều kiện Epic). Không có tên trạng thái nào trong câu.
 * Epic và "bắt đầu bằng" không diễn tả được bằng JQL → lọc phía trình duyệt (`titlePrefixMatches`, theo `epicId`).
 */
export function filterToJql(f: FilterJqlInput): string {
  const parts = [`project = ${q(f.projectKey)}`];
  if (f.typeName) parts.push(`type = ${q(f.typeName)}`);
  if (f.unassigned) parts.push('assignee IS EMPTY');
  if (f.titleContains) parts.push(`summary ~ ${q(f.titleContains)}`);
  return `${parts.join(' AND ')} ORDER BY key ASC`;
}

/** Tiêu đề bắt đầu bằng `prefix` (bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng đầu): `[Test] Đăng nhập` khớp `[test]`. */
export function titlePrefixMatches(summary: string, prefix: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/đ/g, 'd');
  return norm(summary).startsWith(norm(prefix));
}

/** Phần chữ trong `[...]` (để làm từ khoá `summary ~`): `[Test]` → `Test`. */
export const prefixKeyword = (prefix: string): string => prefix.replace(/^\[|\]$/g, '').trim();
