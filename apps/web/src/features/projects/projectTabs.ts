import type { PermissionKey } from '@tirapro/types';

/** Segment URL của các màn nằm trong menu "Thêm" (khớp `MORE` ở ProjectLayout; Rủi ro/Tự động hoá ở trang ngoài dự án). */
const MORE_SEGMENTS = ['triage', 'activity', 'trash', 'config'] as const;
export type MoreSeg = (typeof MORE_SEGMENTS)[number];

/** Nhãn chữ của tab hiện không (màn hẹp, dưới `sm`)? Chỉ tab đang mở, để biết đang ở view nào; từ `sm` trở lên luôn hiện (CSS lo). */
export function tabLabelVisible(isActive: boolean): boolean {
  return isActive;
}

/** Đang ở màn thuộc menu "Thêm" (Việc mới vào, Hoạt động, Thùng rác, Cấu hình)? → nút "Thêm" sáng + hiện tên màn. */
export function activeMoreSeg(seg: string): MoreSeg | null {
  return (MORE_SEGMENTS as readonly string[]).includes(seg) ? (seg as MoreSeg) : null;
}

/**
 * Các màn trong một dự án (`/p/KEY/<seg>`): nhãn + từ khoá để gợi ý khi gõ sai đường dẫn. Nhãn của 5 tab chính là
 * nguồn của `ProjectLayout` (VIEWS).
 */
export const PROJECT_VIEW_LABELS = {
  board: 'Bảng việc',
  backlog: 'Việc chờ',
  gantt: 'Lịch trình',
  tree: 'Cây việc',
  reports: 'Báo cáo',
} as const;

export const PROJECT_VIEW_ENTRIES: readonly { seg: string; label: string; keywords: string[] }[] = [
  { seg: 'board', label: PROJECT_VIEW_LABELS.board, keywords: ['board', 'bang'] },
  { seg: 'backlog', label: PROJECT_VIEW_LABELS.backlog, keywords: ['viec cho'] },
  { seg: 'gantt', label: PROJECT_VIEW_LABELS.gantt, keywords: ['timeline', 'lich trinh'] },
  { seg: 'tree', label: PROJECT_VIEW_LABELS.tree, keywords: ['viec', 'epic'] },
  { seg: 'reports', label: PROJECT_VIEW_LABELS.reports, keywords: ['report', 'bao cao'] },
  { seg: 'activity', label: 'Hoạt động', keywords: ['hoat dong', 'lich su'] },
  { seg: 'config', label: 'Cấu hình', keywords: ['settings', 'cau hinh', 'cai dat'] },
];

/**
 * Mục menu "Thêm" hiện cho người dùng: mục có `needs` (quyền cấp dự án, vd `issue:triage` cho "Việc mới vào") chỉ hiện khi có
 * quyền; Rủi ro / Tự động hoá cần biết dự án (`hasProject`) vì đường dẫn mang `?project=<id>`.
 */
export function visibleMoreItems<T extends { id: string; needs?: PermissionKey }>(
  items: readonly T[],
  can: (perm: PermissionKey) => boolean,
  hasProject: boolean,
): T[] {
  return items
    .filter((m) => !m.needs || can(m.needs))
    .filter((m) => hasProject || (m.id !== 'risks' && m.id !== 'automation'));
}
