import type { IssueDto } from '@tirapro/types';
import { isEpicIssue, treeParentId } from './issueRefs';
import { descendantIdsWithSelf } from './issueTree';

export function epicIdOf(issue: IssueDto, byId: Map<string, IssueDto>): string | null {
  if (issue.epicId) return issue.epicId;
  const p = issue.parentId ? byId.get(issue.parentId) : undefined;
  return p && isEpicIssue(p) ? p.id : null;
}

export interface PointsProgress {
  donePoints: number;
  totalPoints: number;
  doneCount: number;
  totalCount: number;
  pct: number;
}

/** Thành viên TRỰC TIẾP của epic (epicId hoặc cha là epic), bỏ sub-task. Không đệ quy: tránh tính trùng cha-con cùng có điểm. */
export function epicMembers(issues: IssueDto[], epicId: string): IssueDto[] {
  return issues.filter(
    (i) => i.id !== epicId && !i.type.isSubtask && (i.epicId === epicId || i.parentId === epicId),
  );
}
export function epicProgress(issues: IssueDto[], epicId: string): PointsProgress {
  const m = epicMembers(issues, epicId);
  const done = (i: IssueDto) => i.status.category === 'DONE';
  const totalPoints = m.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const donePoints = m.filter(done).reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const doneCount = m.filter(done).length;
  const pct =
    totalPoints > 0
      ? Math.round((donePoints / totalPoints) * 100)
      : m.length > 0
        ? Math.round((doneCount / m.length) * 100)
        : 0;
  return { donePoints, totalPoints, doneCount, totalCount: m.length, pct };
}

function childrenByTreeParent(issues: IssueDto[]): Map<string, IssueDto[]> {
  const m = new Map<string, IssueDto[]>();
  for (const i of issues) {
    const p = treeParentId(i);
    if (p) (m.get(p) ?? m.set(p, []).get(p)!).push(i);
  }
  return m;
}
/** Điểm cộng dồn của TOÀN BỘ con cháu (đệ quy, bỏ sub-task, không tính root) — cho Cây việc. */
export function rollupPoints(
  issues: IssueDto[],
  rootId: string,
): { donePoints: number; totalPoints: number; count: number } {
  const kids = childrenByTreeParent(issues);
  const seen = new Set([rootId]);
  const stack = [...(kids.get(rootId) ?? [])];
  let donePoints = 0,
    totalPoints = 0,
    count = 0;
  while (stack.length) {
    const i = stack.pop()!;
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    if (!i.type.isSubtask) {
      count += 1;
      totalPoints += i.storyPoints ?? 0;
      if (i.status.category === 'DONE') donePoints += i.storyPoints ?? 0;
    }
    for (const c of kids.get(i.id) ?? []) stack.push(c);
  }
  return { donePoints, totalPoints, count };
}

export function epicChoices(issues: IssueDto[], selfId: string): IssueDto[] {
  return issues
    .filter((i) => i.id !== selfId && isEpicIssue(i))
    .sort(
      (a, b) =>
        Number(a.status.category === 'DONE') - Number(b.status.category === 'DONE') ||
        a.key.localeCompare(b.key),
    );
}
export function parentChoices(issues: IssueDto[], selfId: string): IssueDto[] {
  const banned = descendantIdsWithSelf(issues, selfId); // import từ issueTree
  return issues.filter((i) => !banned.has(i.id) && !isEpicIssue(i) && !i.type.isSubtask);
}
export function epicCounts(issues: IssueDto[]): Map<string, number> {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const m = new Map<string, number>();
  for (const i of issues) {
    if (isEpicIssue(i)) continue; // epic không nằm trong "Không thuộc epic"
    const k = epicIdOf(i, byId) ?? 'none';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
export function applyEpicFilter(
  list: IssueDto[],
  filter: string | null,
  byId: Map<string, IssueDto>,
): IssueDto[] {
  if (filter === null) return list;
  return list.filter((i) =>
    filter === 'none'
      ? !isEpicIssue(i) && epicIdOf(i, byId) === null
      : epicIdOf(i, byId) === filter,
  );
}
