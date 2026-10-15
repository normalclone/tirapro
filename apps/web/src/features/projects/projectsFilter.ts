import type { ProjectDto } from '@tirapro/types';
import { normalizeVi } from '@/features/command/commandFilter';

/**
 * Lọc danh sách dự án theo chữ gõ: không dấu, không phân biệt hoa/thường, mọi từ gõ phải có
 * trong tên + mã + người phụ trách. Chuỗi rỗng → trả nguyên danh sách.
 */
export function filterProjects(projects: readonly ProjectDto[], query: string): ProjectDto[] {
  const words = normalizeVi(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...projects];
  return projects.filter((p) => {
    const hay = normalizeVi(`${p.name} ${p.key} ${p.lead?.displayName ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}
