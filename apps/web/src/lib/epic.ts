import type { IssueDto } from '@tirapro/types';
import { isEpicIssue, treeParentId } from './issueRefs';
import { buildProgressMap, descendantIdsWithSelf, type SubtreeProgress } from './issueTree';

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

const byIdOf = (issues: IssueDto[]) => new Map(issues.map((i) => [i.id, i]));

/**
 * MỘT định nghĩa "thành viên trực tiếp của epic E" cho danh sách, tiến độ, panel Epic, lọc, đếm và kéo-thả vào epic:
 * không phải epic/sub-task và `epicIdOf(i) === E` (epicId, hoặc cha trực tiếp là epic; epicId thắng như ô Epic hiển thị).
 * Nhờ vậy một việc chỉ thuộc đúng MỘT epic, và việc có cha thường P nhưng epicId = E vẫn thuộc E.
 */
export function memberEpicId(i: IssueDto, byId: Map<string, IssueDto>): string | null {
  return isEpicIssue(i) || i.type.isSubtask ? null : epicIdOf(i, byId);
}
export function isEpicMember(i: IssueDto, epicId: string, byId: Map<string, IssueDto>): boolean {
  return memberEpicId(i, byId) === epicId;
}

/** Thành viên TRỰC TIẾP của epic. Không đệ quy: tránh tính trùng cha-con cùng có điểm. `byId` truyền sẵn để khỏi dựng lại. */
export function epicMembers(
  issues: IssueDto[],
  epicId: string,
  byId: Map<string, IssueDto> = byIdOf(issues),
): IssueDto[] {
  return issues.filter((i) => isEpicMember(i, epicId, byId));
}

/**
 * Danh sách "việc con" hiện ở panel của `issue`. Epic: đúng tập thành viên (`epicMembers`) mà `epicProgress` đếm.
 * Việc thường: con theo cây (`parentId ?? epicId`).
 */
export function childrenForPanel(issues: IssueDto[], issue: IssueDto): IssueDto[] {
  if (isEpicIssue(issue)) return epicMembers(issues, issue.id);
  return issues.filter((i) => treeParentId(i) === issue.id);
}
/** Nhãn chữ của thanh tiến độ epic (không chỉ dựa vào màu): "5/13 điểm · 4 việc"; epic chưa có điểm: "2/4 việc". */
export function epicProgressLabel(p: PointsProgress): string {
  if (p.totalPoints > 0) return `${p.donePoints}/${p.totalPoints} điểm · ${p.totalCount} việc`;
  return `${p.doneCount}/${p.totalCount} việc`;
}

/** MỘT quy tắc tính tiến độ cho tập thành viên: theo điểm; epic chưa có điểm nào thì theo số việc. */
function progressOfMembers(m: IssueDto[]): PointsProgress {
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

export function epicProgress(
  issues: IssueDto[],
  epicId: string,
  byId?: Map<string, IssueDto>,
): PointsProgress {
  return progressOfMembers(epicMembers(issues, epicId, byId));
}

/**
 * Tiến độ epic dạng `SubtreeProgress` cho thanh `TaskProgress` (dòng epic ở Việc chờ/Board, panel epic ở trang việc):
 * CÙNG đơn vị với `epicProgress`/panel Epic — theo điểm, fallback theo số việc khi không có điểm nào (`unit` nói rõ).
 */
export function epicTaskProgress(
  issues: IssueDto[],
  epicId: string,
  byId?: Map<string, IssueDto>,
): SubtreeProgress {
  const m = epicMembers(issues, epicId, byId);
  const p = progressOfMembers(m);
  const byPoints = p.totalPoints > 0;
  const sum = (cat: string) =>
    m
      .filter((i) => i.status.category === cat)
      .reduce((s, i) => s + (byPoints ? (i.storyPoints ?? 0) : 1), 0);
  return {
    total: byPoints ? p.totalPoints : p.totalCount,
    done: sum('DONE'),
    inProgress: sum('IN_PROGRESS'),
    todo: sum('TODO'),
    pct: p.pct,
    unit: byPoints ? 'điểm' : 'việc',
  };
}

/**
 * Bản đồ tiến độ cho DÒNG/THẺ ở Việc chờ và Board: như `buildProgressMap` nhưng dòng epic dùng đúng tập thành viên epic
 * (cùng số việc với panel Epic và danh sách việc con), không phải cả cây con cháu.
 */
export function buildListProgressMap(issues: IssueDto[]): Map<string, SubtreeProgress> {
  const m = buildProgressMap(issues);
  const byId = byIdOf(issues);
  for (const e of issues) {
    if (!isEpicIssue(e)) continue;
    if (epicMembers(issues, e.id, byId).length === 0) m.delete(e.id);
    else m.set(e.id, epicTaskProgress(issues, e.id, byId));
  }
  return m;
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
    const k = memberEpicId(i, byId) ?? 'none';
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
      ? !isEpicIssue(i) && memberEpicId(i, byId) === null
      : memberEpicId(i, byId) === filter,
  );
}

export type EpicAssignPlan =
  | { kind: 'ignore' }
  | { kind: 'reject'; reason: string }
  | {
      kind: 'set';
      patch: { epicId: string | null; parentId?: null };
      restore: { epicId: string | null; parentId?: string | null };
    };

/**
 * Kết quả khi thả `issue` lên một mục panel Epic (`target` = id epic hoặc 'none'). Con trực tiếp của một epic (cha là epic)
 * đổi sang epic khác thì gỡ luôn `parentId` để không thuộc hai epic cùng lúc; `restore` giữ cả hai cho Hoàn tác.
 * Dùng cùng định nghĩa thành viên với danh sách/tiến độ (`epicIdOf`).
 */
export function planEpicAssign(
  issue: IssueDto,
  target: string,
  byId: Map<string, IssueDto>,
): EpicAssignPlan {
  if (isEpicIssue(issue))
    return { kind: 'reject', reason: 'Epic là cấp cao nhất — không đặt vào epic khác' };
  if (issue.type.isSubtask)
    return { kind: 'reject', reason: 'Việc con đi theo việc cha — hãy gắn epic cho việc cha' };
  const next = target === 'none' ? null : target;
  if (epicIdOf(issue, byId) === next) return { kind: 'ignore' };
  const parent = issue.parentId ? byId.get(issue.parentId) : undefined;
  const parentIsEpic = !!parent && isEpicIssue(parent);
  return {
    kind: 'set',
    patch: { epicId: next, ...(parentIsEpic ? { parentId: null } : {}) },
    restore: {
      epicId: issue.epicId ?? null,
      ...(parentIsEpic ? { parentId: issue.parentId } : {}),
    },
  };
}

export const EPIC_DROP_PREFIX = 'epic:';
/** id droppable của một mục ở panel Epic (`'none'` = "Không thuộc epic"); không đụng id sprint/backlog/dòng việc. */
export const epicDropId = (id: string): string => `${EPIC_DROP_PREFIX}${id}`;
export const parseEpicDropId = (id: string): string | null =>
  id.startsWith(EPIC_DROP_PREFIX) ? id.slice(EPIC_DROP_PREFIX.length) : null;
