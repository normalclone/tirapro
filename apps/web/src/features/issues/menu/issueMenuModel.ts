/**
 * Mục nào có trong menu công việc (chuột phải + nút "…"), theo quyền và bề mặt — hàm thuần, một nguồn cho cả hai menu.
 * Mục ghi mà người dùng không được phép bị ẨN (không hiện vô hiệu rồi báo 403); ngoại lệ: menu con được phép nhưng
 * không có lựa chọn nào (vd việc ở trạng thái cuối) thì hiện và vô hiệu để người dùng hiểu vì sao không chọn được.
 */
export type MenuSurface = 'board' | 'backlog' | 'filters' | 'tree';

export type MenuItemId =
  | 'peek'
  | 'open'
  | 'openTab'
  | 'copyKey'
  | 'copyLink'
  | 'assignMe'
  | 'delete';
export type MenuSubId = 'status' | 'priority' | 'sprint';

export const MENU_LABELS: Record<MenuItemId | MenuSubId, string> = {
  peek: 'Xem nhanh',
  open: 'Mở trang',
  openTab: 'Mở ở tab mới',
  copyKey: 'Sao chép mã',
  copyLink: 'Sao chép liên kết',
  assignMe: 'Gán cho tôi',
  status: 'Đổi trạng thái',
  priority: 'Ưu tiên',
  sprint: 'Chuyển sprint',
  delete: 'Xoá',
};

export type MenuEntry =
  | { kind: 'item'; id: MenuItemId; label: string }
  | { kind: 'sub'; id: MenuSubId; label: string; disabled: boolean }
  | { kind: 'separator' };

export interface IssueMenuInput {
  surface: MenuSurface;
  /** Bề mặt có panel xem nhanh để mở (Board, Việc chờ, Bộ lọc, Cây). */
  hasPeek: boolean;
  /** `useCanEditIssue` — sửa được việc này (gán người, ưu tiên, chuyển sprint như ở trang chi tiết). */
  canEdit: boolean;
  /** `issue:transition`. */
  canTransition: boolean;
  /** `issue:delete`. */
  canDelete: boolean;
  /** Người dùng đang là người phụ trách. */
  isMine: boolean;
  /** Số bước chuyển trạng thái kế tiếp hợp lệ. */
  statusOptions: number;
  priorityOptions: number;
  sprintOptions: number;
}

const item = (id: MenuItemId): MenuEntry => ({ kind: 'item', id, label: MENU_LABELS[id] });
const sub = (id: MenuSubId, options: number): MenuEntry => ({
  kind: 'sub',
  id,
  label: MENU_LABELS[id],
  disabled: options === 0,
});

export function issueMenuModel(i: IssueMenuInput): MenuEntry[] {
  const nav: MenuEntry[] = [...(i.hasPeek ? [item('peek')] : []), item('open'), item('openTab')];
  const copy: MenuEntry[] = [item('copyKey'), item('copyLink')];
  const act: MenuEntry[] = [
    ...(i.canEdit && !i.isMine ? [item('assignMe')] : []),
    ...(i.canTransition ? [sub('status', i.statusOptions)] : []),
    ...(i.canEdit ? [sub('priority', i.priorityOptions)] : []),
    ...(i.surface === 'backlog' && i.canEdit ? [sub('sprint', i.sprintOptions)] : []),
  ];
  const danger: MenuEntry[] = i.canDelete ? [item('delete')] : [];
  const out: MenuEntry[] = [];
  for (const group of [nav, copy, act, danger]) {
    if (group.length === 0) continue;
    if (out.length > 0) out.push({ kind: 'separator' });
    out.push(...group);
  }
  return out;
}
