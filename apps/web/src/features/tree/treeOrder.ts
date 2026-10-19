import type { IssueTreeNode } from '@/lib/issueTree';

/** Làm phẳng cây thành danh sách hàng HIỂN THỊ (duyệt sâu trước), tôn trọng node đang thu gọn. */
export function flattenVisible(
  nodes: IssueTreeNode[],
  collapsed: ReadonlySet<string>,
  out: IssueTreeNode[] = [],
): IssueTreeNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children.length && !collapsed.has(n.issue.id)) flattenVisible(n.children, collapsed, out);
  }
  return out;
}

/** Khoá việc của các hàng đang thấy, theo thứ tự trên màn hình — thứ tự của panel xem nhanh (bỏ qua con của nhánh thu gọn). */
export const visibleKeys = (rows: readonly IssueTreeNode[]): string[] =>
  rows.map((r) => r.issue.key);
