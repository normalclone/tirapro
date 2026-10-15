import { mentionToken } from '@tirapro/shared';
import { normalizeVi } from '@/lib/text';
export interface MentionPerson {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  position?: string;
}
export interface MentionTrigger {
  start: number;
  query: string;
}
const MAX_QUERY = 25;

export function findMentionTrigger(value: string, caret: number): MentionTrigger | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n@[\]]/.test(query)) return null;
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  return { start: at, query };
}

export function filterMentionCandidates<T extends MentionPerson>(
  people: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const q = normalizeVi(query);
  const scored = people
    .map((p) => {
      const name = normalizeVi(p.name);
      const mail = normalizeVi(p.email ?? '');
      let score = 0;
      if (!q) score = 1;
      else if (name.startsWith(q)) score = 4;
      else if (name.split(/\s+/).some((w) => w.replace(/[()]/g, '').startsWith(q))) score = 3;
      else if (name.includes(q)) score = 2;
      else if (mail.startsWith(q) || mail.includes(q)) score = 1;
      return { p, score, name };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'vi'));
  return scored.slice(0, limit).map((x) => x.p);
}

export function applyMention(
  value: string,
  trigger: MentionTrigger,
  caret: number,
  person: Pick<MentionPerson, 'id' | 'name'>,
) {
  const token = mentionToken(person.id, person.name);
  const before = value.slice(0, trigger.start);
  const after = value.slice(caret);
  const needSpace = after.length === 0 || !/^\s/.test(after);
  const next = before + token + (needSpace ? ' ' : '') + after;
  return { value: next, caret: before.length + token.length + 1 };
}

/**
 * Tên hiển thị của chip: tra theo userId trong danh sách thành viên (chống giả tên — ai cũng gõ được
 * `@[Admin](user:<id người khác>)`); chưa tải xong / không tìm thấy thì dùng tên ghi trong token.
 */
export function resolveMentionName(
  users: readonly { id: string; displayName: string }[] | undefined,
  id: string,
  tokenName: string,
): string {
  return users?.find((u) => u.id === id)?.displayName || tokenName;
}
