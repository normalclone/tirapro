import { JIRA_CREATE, type JiraMappingInput } from '@tirapro/shared';
import type { JiraAnalyzeResult } from '@tirapro/types';
import type { JiraIssueRow } from './jira-csv.parser';

export { JIRA_CREATE };

/** Phần của kết quả analyze mà việc kiểm tra mapping cần. */
type AnalysisLike = Pick<JiraAnalyzeResult, 'issueTypes' | 'statuses' | 'priorities'>;

export interface MissingMapping {
  issueTypes: string[];
  statuses: string[];
  priorities: string[];
}

/** Tra mapping chỉ theo khoá sở hữu (tên Jira như `constructor`/`__proto__` không được chạm prototype). */
export function ownValue<T>(m: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(m, key) ? m[key] : undefined;
}

/** Giá trị Jira còn chưa được ghép (loại/trạng thái/ưu tiên bắt buộc ghép; user thì có thể bỏ trống). */
export function findMissingMapping(
  analysis: AnalysisLike,
  mapping: JiraMappingInput,
): MissingMapping {
  const miss = (values: string[], m: Record<string, string>): string[] =>
    values.filter((v) => !ownValue(m, v));
  return {
    issueTypes: miss(analysis.issueTypes, mapping.issueTypes),
    statuses: miss(analysis.statuses, mapping.statuses),
    priorities: miss(analysis.priorities, mapping.priorities),
  };
}

export function hasMissing(m: MissingMapping): boolean {
  return m.issueTypes.length + m.statuses.length + m.priorities.length > 0;
}

/** Thông báo "người dùng cần làm gì" liệt kê đủ các giá trị thiếu. */
export function formatMissing(m: MissingMapping): string {
  const parts: string[] = [];
  if (m.issueTypes.length) parts.push(`loại công việc: ${m.issueTypes.join(', ')}`);
  if (m.statuses.length) parts.push(`trạng thái: ${m.statuses.join(', ')}`);
  if (m.priorities.length) parts.push(`mức ưu tiên: ${m.priorities.join(', ')}`);
  return `Còn giá trị Jira chưa được ghép — hãy chọn giá trị Tirapro hoặc "Tạo mới" cho ${parts.join('; ')}`;
}

/** Jira không xuất category của trạng thái → đoán theo tên để trạng thái mới tạo có nhóm hợp lý. */
export function inferStatusCategory(name: string): 'TODO' | 'IN_PROGRESS' | 'DONE' {
  const n = name.toLowerCase();
  if (
    /\b(done|closed|resolved|complete[d]?|finished|released|cancel+ed|won't|wont)\b|hoàn thành|đã xong|đóng/.test(
      n,
    )
  )
    return 'DONE';
  if (/\b(to ?do|open|backlog|new|created|selected|ready|reopened)\b|cần làm|mở|mới/.test(n))
    return 'TODO';
  return 'IN_PROGRESS';
}

/** Rank (cao = ưu tiên cao) cho ưu tiên Jira mới tạo. */
export function inferPriorityRank(name: string): number {
  const n = name.toLowerCase();
  if (/highest|blocker|critical|urgent/.test(n)) return 5;
  if (/high|major/.test(n)) return 4;
  if (/lowest|trivial/.test(n)) return 1;
  if (/low|minor/.test(n)) return 2;
  return 3;
}

export const isSubtaskTypeName = (name: string): boolean => /^sub-?\s?task$/i.test(name.trim());
export const isEpicTypeName = (name: string): boolean => name.trim().toLowerCase() === 'epic';

export interface IssueLinks {
  parent: JiraIssueRow | null;
  epic: JiraIssueRow | null;
  warnings: string[];
}

/**
 * Tra cột Parent / Epic Link về dòng trong file. Parent có thể là mã issue (ABC-1) hoặc id số
 * (tuỳ phiên bản Jira) nên tra cả hai. Việc con thường (không phải subtask) có Parent là epic
 * (Jira Cloud mới dùng Parent thay Epic Link) → chuyển thành epic của nó, không phải việc cha.
 * Tham chiếu ngoài file → bỏ liên kết kèm cảnh báo.
 */
export function resolveLinks(
  rows: JiraIssueRow[],
  isEpic: (r: JiraIssueRow) => boolean,
  isSubtask: (r: JiraIssueRow) => boolean,
): Map<JiraIssueRow, IssueLinks> {
  const byKey = new Map<string, JiraIssueRow>();
  const byId = new Map<string, JiraIssueRow>();
  for (const r of rows) {
    if (r.key) byKey.set(r.key, r);
    if (r.id) byId.set(r.id, r);
  }
  const find = (ref: string, self: JiraIssueRow): JiraIssueRow | null => {
    const hit = byKey.get(ref) ?? byId.get(ref) ?? null;
    return hit === self ? null : hit;
  };

  const out = new Map<JiraIssueRow, IssueLinks>();
  for (const r of rows) {
    const warnings: string[] = [];
    let parent: JiraIssueRow | null = null;
    let epic: JiraIssueRow | null = null;

    if (r.parentRef) {
      const hit = find(r.parentRef, r);
      if (!hit)
        warnings.push(`Không tìm thấy việc cha "${r.parentRef}" trong tệp — tạo không có việc cha`);
      else if (isSubtask(r) || !isEpic(hit)) parent = hit;
      else epic = hit;
    }
    if (r.epicRef) {
      const hit = find(r.epicRef, r);
      if (!hit) warnings.push(`Không tìm thấy epic "${r.epicRef}" trong tệp — tạo không gắn epic`);
      else epic = hit;
    }
    out.set(r, { parent, epic, warnings });
  }
  return out;
}

/**
 * Chia các dòng thành các tầng: tầng sau chỉ phụ thuộc (cha/epic) vào tầng trước nên có thể tạo
 * lần lượt và resolve `jiraKey → id`. Thứ tự: epic (đầu tầng 0) → việc thường → subtask (luôn sau
 * mọi việc thường). Vòng phụ thuộc bị cắt (coi như không có cha).
 */
export function layerIssues(
  rows: JiraIssueRow[],
  links: Map<JiraIssueRow, IssueLinks>,
  isEpic: (r: JiraIssueRow) => boolean,
  isSubtask: (r: JiraIssueRow) => boolean,
): JiraIssueRow[][] {
  // Độ sâu chỉ tính trên các phụ thuộc cùng "nhóm" (việc thường với việc thường, subtask với subtask):
  // subtask luôn được xếp sau toàn bộ việc thường nên không cần tính cha thường vào độ sâu của nó.
  const level = new Map<JiraIssueRow, number>();
  const visiting = new Set<JiraIssueRow>();
  const depth = (r: JiraIssueRow): number => {
    const known = level.get(r);
    if (known !== undefined) return known;
    visiting.add(r);
    const l = links.get(r);
    let d = 0;
    for (const dep of [l?.parent, l?.epic]) {
      if (dep && isSubtask(dep) === isSubtask(r) && !visiting.has(dep))
        d = Math.max(d, depth(dep) + 1); // gặp vòng thì bỏ cạnh đó
    }
    visiting.delete(r);
    level.set(r, d);
    return d;
  };

  const normal = rows.filter((r) => !isSubtask(r));
  const subs = rows.filter(isSubtask);
  const layers: JiraIssueRow[][] = [];
  for (const r of normal) (layers[depth(r)] ??= []).push(r);
  // Epic lên đầu tầng 0 (giữ thứ tự tương đối trong file).
  if (layers[0]) layers[0] = [...layers[0].filter(isEpic), ...layers[0].filter((r) => !isEpic(r))];
  const base = layers.length;
  for (const r of subs) (layers[base + depth(r)] ??= []).push(r);
  return layers.filter((l): l is JiraIssueRow[] => Array.isArray(l) && l.length > 0);
}

/** Tối đa bao nhiêu người phụ trách không khớp được liệt kê trong báo cáo import (phần còn lại gộp "và N người khác"). */
export const MAX_UNMATCHED_LISTED = 20;
/** Độ dài tối đa của mỗi tên/email khi liệt kê (tên Jira có thể rất dài). */
export const MAX_UNMATCHED_NAME_LENGTH = 80;

/**
 * Người phụ trách Jira của các việc đã nhập mà KHÔNG được gán:
 *  - `unmatched`: tên/email KHÔNG có trong `mapping.users` (không khớp thành viên nào) → cần cảnh báo;
 *  - `blank`: người dùng CHỦ ĐỘNG chọn "Để trống" (`null`/rỗng) → chỉ đếm trung tính, không cảnh báo.
 */
export interface AssigneeTally {
  unmatched: Map<string, number>;
  blank: number;
}

export const newAssigneeTally = (): AssigneeTally => ({ unmatched: new Map(), blank: 0 });

/** Ghi nhận một việc: dùng chung cho dry-run (mọi dòng) và chạy thật (chỉ việc đã tạo được). */
export function tallyAssignee(
  tally: AssigneeTally,
  assignee: string,
  users: Record<string, string | null>,
): void {
  if (!assignee) return;
  const target = ownValue(users, assignee);
  if (target) return; // đã ghép → được gán
  if (target === undefined) tally.unmatched.set(assignee, (tally.unmatched.get(assignee) ?? 0) + 1);
  else tally.blank++;
}

export interface UnmatchedAssignees {
  /** Số việc không có người phụ trách vì tên/email Jira không khớp thành viên nào. */
  skipped: number;
  /** Tên/email Jira không khớp, nhiều việc nhất trước (≤ `MAX_UNMATCHED_LISTED`, mỗi tên cắt ≤ `MAX_UNMATCHED_NAME_LENGTH`). */
  listed: Array<{ name: string; count: number }>;
  /** Số tên khác nhau không được liệt kê vì vượt giới hạn. */
  more: number;
}

const clip = (s: string): string =>
  s.length > MAX_UNMATCHED_NAME_LENGTH ? `${s.slice(0, MAX_UNMATCHED_NAME_LENGTH - 1)}…` : s;

/**
 * Gom người phụ trách Jira không khớp thành viên nào (`counts`: tên/email → số việc). Rỗng → null.
 * Việc đã nhập bình thường nhưng bị bỏ gán — cần báo lại thay vì im lặng.
 */
export function summarizeUnmatchedAssignees(
  counts: ReadonlyMap<string, number>,
  max = MAX_UNMATCHED_LISTED,
): UnmatchedAssignees | null {
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    skipped: sorted.reduce((s, x) => s + x.count, 0),
    listed: sorted.slice(0, max).map((x) => ({ name: clip(x.name), count: x.count })),
    more: Math.max(0, sorted.length - max),
  };
}

/** Câu cảnh báo cho báo cáo import (một dòng). */
export function formatUnmatchedAssignees(u: UnmatchedAssignees): string {
  const names = u.listed.map((x) => `${x.name} (${x.count} việc)`).join(', ');
  const more = u.more > 0 ? ` và ${u.more} người khác` : '';
  return `${u.skipped} việc được nhập nhưng KHÔNG có người phụ trách vì người phụ trách trong Jira không khớp thành viên nào: ${names}${more}. Hãy ghép họ với thành viên (hoặc thêm họ vào không gian làm việc) rồi gán lại.`;
}
