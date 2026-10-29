import { useSearchParams } from 'react-router-dom';

/** Id dự án trong `?project=<id>` nếu thuộc danh sách; ngược lại null (id lạ, rỗng, danh sách chưa tải). */
export function scopeFromParam(
  param: string | null,
  projects: { id: string }[] | undefined,
): string | null {
  if (!param || !projects) return null;
  return projects.some((p) => p.id === param) ? param : null;
}

/**
 * Phạm vi dự án từ `?project=<id>` (lối vào từ menu "Thêm" của dự án). Trả null khi không có/không hợp lệ.
 * Trang dùng làm GIÁ TRỊ MẶC ĐỊNH: `lựaChọnNgườiDùng ?? useScopeParam(projects)` — người dùng đổi/xoá bộ lọc thì thắng,
 * và danh sách dự án về sau vẫn áp được (không cần effect).
 */
export function useScopeParam(projects: { id: string }[] | undefined): string | null {
  const [params] = useSearchParams();
  return scopeFromParam(params.get('project'), projects);
}
