/**
 * Loại công việc có phải "Bug" không — dùng quyết định hiển thị khối chỉ dành cho lỗi (Môi trường, Severity).
 * Ưu tiên khoá hệ thống BUG; loại tuỳ chỉnh nhận theo tên ("Bug", "Lỗi", "Production bug"…).
 */
export function isBugType(type: { key?: string | null; name: string } | null | undefined): boolean {
  if (!type) return false;
  if (type.key === 'BUG') return true;
  return /\bbug\b|\blỗi\b/i.test(type.name);
}

/** Mức nghiêm trọng chọn sẵn: `isDefault`; không có thì mức rank cao nhất (an toàn: coi là nặng); rỗng => null. */
export function defaultSeverityId(
  list: ReadonlyArray<{ id: string; rank: number; isDefault: boolean }>,
): string | null {
  return (
    (list.find((s) => s.isDefault) ?? [...list].sort((a, b) => b.rank - a.rank)[0])?.id ?? null
  );
}
