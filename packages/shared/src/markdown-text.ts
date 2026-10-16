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

const ISSUE_KEY_BODY = '[A-Z][A-Z0-9_]*(?:-[A-Z][A-Z0-9]*)*-\\d+';

/**
 * Nhận mã công việc cho chip markdown, `extractIssueKeys`, `issueRefs`, Cmd+K/URL: mã Tirapro `PROJ-TYPE-N` và mã Jira gốc
 * `KEY-N` (khoá Jira có thể chứa `_`, vd `MY_APP-12`). KHÔNG dùng regex lookbehind (khẳng định nhìn lại phía trước): hằng regex tạo ở cấp module nằm trong
 * chunk đầu của web, mà Safari/iOS < 16.4 báo SyntaxError lúc nạp → trắng trang. Thay vào đó "ranh giới trước" là nhóm bắt
 * `(^|[^…])` và `matchIssueKeys` tính lại vị trí thật của mã.
 * - Mặc định: cấm chữ/số/`_`/`-` liền kề cả hai phía (`MY_APP-12` không khớp một phần `APP-12`).
 * - `embedded` (tên nhánh/commit, dev-links): cho phép `-` liền kề (`feature/DEMO-5-login`, `fix-DEMO-5`) nhưng vẫn cấm chữ/số/`_`.
 */
function issueKeyRegex(embedded: boolean): RegExp {
  const before = embedded ? '[^A-Za-z0-9_]' : '[^A-Za-z0-9_-]';
  const notAfter = embedded ? '[A-Za-z0-9_]' : '[A-Za-z0-9_-]';
  return new RegExp(`(^|${before})(${ISSUE_KEY_BODY})(?!${notAfter})`, 'g');
}

export interface IssueKeyMatch {
  /** Mã công việc (vd `DEMO-BUG-1`). */
  key: string;
  /** Vị trí bắt đầu của mã trong văn bản (không tính ký tự ranh giới đứng trước). */
  index: number;
}

/** Mọi mã công việc trong `text`, theo thứ tự xuất hiện (cùng một mã có thể lặp). */
export function matchIssueKeys(text: string, embedded = false): IssueKeyMatch[] {
  const out: IssueKeyMatch[] = [];
  for (const m of text.matchAll(issueKeyRegex(embedded))) {
    out.push({ key: m[2]!, index: m.index + m[1]!.length });
  }
  return out;
}

/** `s` (đã trim) CHÍNH LÀ một mã công việc (không phải văn bản chứa mã). */
export function isIssueKey(s: string): boolean {
  return new RegExp(`^${ISSUE_KEY_BODY}$`).test(s);
}
export function extractIssueKeys(text: string, max = 50, embedded = false): string[] {
  const keys = new Set<string>();
  for (const { key } of matchIssueKeys(text, embedded)) {
    keys.add(key);
    if (keys.size >= max) break;
  }
  return [...keys];
}
