const FENCE = /^\s*(```|~~~)/;
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?:\s+(.*))?$/;
const MENTION = () => /@\[([^\]\n]{1,80})\]\(user:([A-Za-z0-9_-]{1,64})\)/g;
export const MENTION_LIMIT = 20;

export const isFenceLine = (line: string): boolean => FENCE.test(line);
export const matchTaskLine = (line: string): RegExpExecArray | null =>
  TASK.exec(line.replace(/\r$/, ''));

export interface TaskItem {
  index: number;
  line: number;
  checked: boolean;
  text: string;
}

export function listTaskItems(md: string): TaskItem[] {
  const out: TaskItem[] = [];
  let fenced = false;
  md.split('\n').forEach((line, i) => {
    if (isFenceLine(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = matchTaskLine(line);
    if (m)
      out.push({ index: out.length, line: i, checked: m[2] !== ' ', text: (m[3] ?? '').trim() });
  });
  return out;
}

export function countTasks(md: string | null | undefined) {
  if (!md) return null;
  const items = listTaskItems(md);
  return items.length ? { done: items.filter((i) => i.checked).length, total: items.length } : null;
}

function rewriteLine(line: string, checked: boolean): string {
  return line.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]'); // [..] đầu tiên của dòng task luôn là ô tick
}

export function setTaskChecked(
  md: string,
  index: number,
  checked: boolean,
  expectText?: string,
): string | null {
  const item = listTaskItems(md)[index];
  if (!item) return null;
  if (expectText !== undefined && item.text !== expectText.trim()) return null;
  const lines = md.split('\n');
  lines[item.line] = rewriteLine(lines[item.line]!, checked);
  return lines.join('\n');
}

export function uncheckAllTasks(md: string): string {
  const lines = md.split('\n');
  for (const it of listTaskItems(md))
    if (it.checked) lines[it.line] = rewriteLine(lines[it.line]!, false);
  return lines.join('\n');
}

export function mentionToken(userId: string, displayName: string): string {
  const name =
    displayName
      .replace(/[[\]\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Người dùng';
  return `@[${name}](user:${userId})`;
}

export function extractMentionIds(text: string, max = MENTION_LIMIT): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(MENTION())) {
    ids.add(m[2]!);
    if (ids.size >= max) break;
  }
  return [...ids];
}
export const mentionsToPlain = (text: string): string => text.replace(MENTION(), '@$1');

export function plainExcerpt(md: string | null | undefined, max = 80): string {
  if (!md) return '';
  const plain = mentionsToPlain(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * MỘT regex nhận mã công việc cho chip markdown, `extractIssueKeys`, `issueRefs`, Cmd+K/URL: mã Tirapro `PROJ-TYPE-N`
 * và mã Jira gốc `KEY-N` (khoá Jira có thể chứa `_`, vd `MY_APP-12`). Lookbehind/lookahead cấm cả `_` để
 * `MY_APP-12` không khớp một phần `APP-12`.
 */
export const ISSUE_KEY_RE =
  /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9_]*(?:-[A-Z][A-Z0-9]*)*-\d+(?![A-Za-z0-9_-])/g;

/** `s` (đã trim) CHÍNH LÀ một mã công việc (không phải văn bản chứa mã). */
export function isIssueKey(s: string): boolean {
  const m = new RegExp(ISSUE_KEY_RE.source).exec(s);
  return m !== null && m[0] === s;
}
export function extractIssueKeys(text: string, max = 50): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(new RegExp(ISSUE_KEY_RE.source, 'g'))) {
    keys.add(m[0]);
    if (keys.size >= max) break;
  }
  return [...keys];
}
