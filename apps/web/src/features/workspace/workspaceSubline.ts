import { roleLabel } from '@tirapro/types';
import type { MyWorkspace } from './api';

/**
 * Dòng 2 của mục không gian làm việc: "12 thành viên · Quản trị chung" (đếm trước, vai trò sau). `count` tách riêng để vẽ
 * `tabular-nums`. API cũ (chưa triển khai) không trả `memberCount` → chỉ còn vai trò.
 */
export function workspaceSubline(ws: Pick<MyWorkspace, 'roleName' | 'memberCount'>): {
  count: number | null;
  text: string;
  title: string;
} {
  const role = roleLabel(ws.roleName);
  const n = ws.memberCount;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0)
    return { count: null, text: role, title: `Vai trò của bạn: ${role}` };
  return {
    count: n,
    text: `thành viên · ${role}`,
    title: `${n} thành viên đang hoạt động · Vai trò của bạn: ${role}`,
  };
}
