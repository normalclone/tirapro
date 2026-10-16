import { useCanIn, useProjectPermissions } from '@/features/projects/permissions';

/**
 * Người dùng có `comment:create` ở dự án không — gộp vào bug cũ là một bình luận nên cần quyền này. Quyền chưa tải
 * thì coi là có (server vẫn kiểm và có nhánh an toàn: thiếu quyền thì tạo bug mới, không mất nội dung).
 */
export function useCanComment(projectId: string | undefined): boolean {
  const can = useCanIn(projectId);
  const loaded = !!useProjectPermissions(projectId).data;
  return !projectId || !loaded || can('comment:create');
}
