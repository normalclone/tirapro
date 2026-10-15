import type { IssueDto } from '@tirapro/types';
import { byPriorityThenStatus } from './issueOrder';
import { treeParentId } from './issueRefs';

export interface IssueTreeNode {
  issue: IssueDto;
  children: IssueTreeNode[];
  depth: number;
}

/**
 * Dựng cây issue theo cha-trong-cây `parentId ?? epicId` (`treeParentId`). Gốc = issue không có cha HOẶC
 * cha không nằm trong tập hiện tại (mồ côi → coi như gốc, không mất issue). Issue nằm trong vòng lẫn
 * (X.parentId=Y, Y.epicId=X) không có gốc nên được nối vào cuối như gốc. Mỗi cấp sắp theo ưu tiên→trạng thái.
 */
export function buildIssueTree(issues: IssueDto[]): IssueTreeNode[] {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const childrenOf = new Map<string, IssueDto[]>();
  const roots: IssueDto[] = [];

  for (const it of issues) {
    const pid = treeParentId(it);
    if (pid && byId.has(pid)) {
      const arr = childrenOf.get(pid) ?? [];
      arr.push(it);
      childrenOf.set(pid, arr);
    } else {
      roots.push(it);
    }
  }

  const build = (issue: IssueDto, depth: number, seen: Set<string>): IssueTreeNode => {
    seen.add(issue.id);
    const kids = (childrenOf.get(issue.id) ?? [])
      .filter((c) => !seen.has(c.id)) // an toàn nếu dữ liệu lỗi tạo vòng
      .slice()
      .sort(byPriorityThenStatus);
    return { issue, children: kids.map((c) => build(c, depth + 1, seen)), depth };
  };

  const seen = new Set<string>();
  const tree = roots
    .slice()
    .sort(byPriorityThenStatus)
    .map((r) => build(r, 0, seen));
  // Lưới an toàn: issue thuộc vòng không có gốc → chưa được duyệt; nối làm gốc để không bao giờ "mất" việc.
  for (const it of issues.slice().sort(byPriorityThenStatus)) {
    if (!seen.has(it.id)) tree.push(build(it, 0, seen));
  }
  return tree;
}

export interface SubtreeProgress {
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  /** % task con (toàn cây) đã ở trạng thái Hoàn thành. */
  pct: number;
}

function childrenMap(issues: IssueDto[]): Map<string, IssueDto[]> {
  const m = new Map<string, IssueDto[]>();
  for (const it of issues) {
    const pid = treeParentId(it);
    if (pid) {
      const arr = m.get(pid) ?? [];
      arr.push(it);
      m.set(pid, arr);
    }
  }
  return m;
}

/** Tiến trình của TOÀN BỘ cây task con (mọi cấp) dưới `rootId`, gom theo nhóm trạng thái. */
export function subtreeProgress(issues: IssueDto[], rootId: string): SubtreeProgress {
  const childrenOf = childrenMap(issues);
  const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0 } as Record<string, number>;
  let total = 0;
  const seen = new Set<string>([rootId]);
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length) {
    const it = stack.pop()!;
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    total += 1;
    counts[it.status.category] = (counts[it.status.category] ?? 0) + 1;
    for (const c of childrenOf.get(it.id) ?? []) stack.push(c);
  }
  const done = counts.DONE ?? 0;
  return {
    total,
    done,
    inProgress: counts.IN_PROGRESS ?? 0,
    todo: counts.TODO ?? 0,
    pct: total ? Math.round((done / total) * 100) : 0,
  };
}

/** Map id→tiến trình cho MỌI task có con (để render nhanh trên board/backlog/tree). */
export function buildProgressMap(issues: IssueDto[]): Map<string, SubtreeProgress> {
  const childrenOf = childrenMap(issues);
  const m = new Map<string, SubtreeProgress>();
  for (const it of issues) {
    if (childrenOf.has(it.id)) m.set(it.id, subtreeProgress(issues, it.id));
  }
  return m;
}

/** Tập id của issue + toàn bộ con cháu (để loại khỏi danh sách chọn cha, tránh vòng lặp). */
export function descendantIdsWithSelf(issues: IssueDto[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const it of issues) {
    const pid = treeParentId(it);
    if (pid) {
      const arr = childrenOf.get(pid) ?? [];
      arr.push(it.id);
      childrenOf.set(pid, arr);
    }
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

/** So sánh tiến độ theo giá trị (bản đồ tiến độ được dựng lại mỗi lần cache đổi nên tham chiếu không dùng được cho `memo`). */
export function sameProgress(
  a: SubtreeProgress | undefined,
  b: SubtreeProgress | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.total === b.total &&
    a.done === b.done &&
    a.inProgress === b.inProgress &&
    a.todo === b.todo &&
    a.pct === b.pct
  );
}
