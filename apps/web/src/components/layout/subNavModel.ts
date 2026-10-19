import type { ReactNode } from 'react';

export interface SubNavItem {
  /** Đường dẫn tuyệt đối của mục (mỗi mục là một route thật). */
  to: string;
  /** Nhãn lấy từ `lib/navLabels`. */
  label: string;
  icon?: ReactNode;
  /** Đã bị lọc quyền/cờ — nơi gọi nên lọc TRƯỚC khi truyền `groups`; cờ này là lưới an toàn. */
  hidden?: boolean;
}

/** Nhóm mục; `label` là chữ thường-hoa kiểu câu (KHÔNG uppercase). Không `label` = không có tiêu đề nhóm. */
export interface SubNavGroup {
  label?: string;
  items: SubNavItem[];
}

/** Bỏ mục `hidden` rồi bỏ nhóm rỗng. */
export function visibleGroups(groups: readonly SubNavGroup[]): SubNavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden) }))
    .filter((g) => g.items.length > 0);
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** `pathname` đang đúng là trang danh sách mục (`basePath`), bỏ qua dấu `/` cuối. */
export function isIndexPath(pathname: string, basePath: string): boolean {
  return trimSlash(pathname) === trimSlash(basePath);
}

/** Tên truy cập của link quay lại trang danh sách mục (nhãn hiển thị là chính `title`). */
export function backLabel(title: string): string {
  return `Quay lại ${title}`;
}
