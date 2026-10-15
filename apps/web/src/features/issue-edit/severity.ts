/**
 * Loại công việc có phải "Bug" không — dùng quyết định hiển thị khối chỉ dành cho lỗi (Môi trường, Severity).
 * Ưu tiên khoá hệ thống BUG; loại tuỳ chỉnh nhận theo tên ("Bug", "Lỗi", "Production bug"…).
 */
export function isBugType(type: { key?: string | null; name: string } | null | undefined): boolean {
  if (!type) return false;
  if (type.key === 'BUG') return true;
  return /\bbug\b|\blỗi\b/i.test(type.name);
}
