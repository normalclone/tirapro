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

export type ProjectSort = 'recent' | 'name' | 'created';

/** Nhãn ô chọn sắp xếp. */
export const PROJECT_SORT_LABEL: Record<ProjectSort, string> = {
  recent: 'Gần nhất',
  name: 'Tên',
  created: 'Ngày tạo',
};

/**
 * Sắp xếp danh sách dự án (không đổi mảng gốc): dự án đã lưu trữ luôn xuống cuối; trong mỗi nhóm —
 * `recent`: dự án xem gần nhất lên đầu, còn lại giữ thứ tự API; `name`: A→Z (tiếng Việt); `created`: mới tạo trước.
 */
export function sortProjects(
  projects: readonly ProjectDto[],
  mode: ProjectSort,
  recentKey?: string,
): ProjectDto[] {
  const rank = (p: ProjectDto) => (p.archivedAt ? 1 : 0);
  const cmp = (a: ProjectDto, b: ProjectDto): number => {
    if (mode === 'name') return a.name.localeCompare(b.name, 'vi');
    if (mode === 'created') return b.createdAt.localeCompare(a.createdAt);
    return (b.key === recentKey ? 1 : 0) - (a.key === recentKey ? 1 : 0);
  };
  // sort ổn định (ES2019): các phần tử bằng nhau giữ thứ tự gốc.
  return [...projects].sort((a, b) => rank(a) - rank(b) || cmp(a, b));
}
