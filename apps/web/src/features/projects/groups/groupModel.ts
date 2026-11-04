import type { ProjectDto, ProjectProgramRefDto } from '@tirapro/types';

/** Nhãn nhóm "không thuộc nhóm nào" — CHỈ để hiển thị; nút này nhận biết bằng `id === null`, không bằng chữ. */
export const UNGROUPED_LABEL = 'Chưa thuộc nhóm';

export interface GroupNode {
  /** `null` = nút "Chưa thuộc nhóm" (dự án không có nhóm nào). */
  id: string | null;
  name: string;
  color: string | null;
  projects: ProjectDto[];
}

/** Khoá ổn định cho React/DOM của một nút (nút "Chưa thuộc nhóm" không có id). */
export const groupKey = (g: Pick<GroupNode, 'id'>): string => g.id ?? '__ungrouped__';

/**
 * Cây Nhóm → Dự án từ danh sách dự án ĐÃ lọc/sắp xếp (tìm kiếm, "Hiện đã lưu trữ"): thứ tự dự án trong nhóm giữ nguyên
 * thứ tự đầu vào; dự án thuộc nhiều nhóm hiện dưới từng nhóm; dự án không nhóm nào gom vào nút cuối (`id === null`).
 * Nhóm xếp theo tên (tiếng Việt). Số dự án của nhóm = số dự án ĐANG HIỆN (cùng bộ lọc) nên khớp với những gì danh sách
 * trả về. `hideEmpty`: bỏ nhóm không còn dự án nào (khi đang lọc); tắt thì nhóm rỗng vẫn hiện để người dùng thấy và gán.
 * `programs` là danh mục nhóm; nhóm xuất hiện trên dự án mà chưa có trong danh mục (cache lệch) vẫn được dựng.
 */
export function buildGroupTree(
  projects: readonly ProjectDto[],
  programs: readonly ProjectProgramRefDto[],
  opts: { hideEmpty: boolean },
): GroupNode[] {
  const nodes = new Map<string, GroupNode>();
  const ensure = (p: ProjectProgramRefDto): GroupNode => {
    let n = nodes.get(p.id);
    if (!n) {
      n = { id: p.id, name: p.name, color: p.color, projects: [] };
      nodes.set(p.id, n);
    }
    return n;
  };
  for (const p of programs) ensure(p);
  const ungrouped: GroupNode = { id: null, name: UNGROUPED_LABEL, color: null, projects: [] };
  for (const project of projects) {
    const refs = project.programs ?? [];
    if (refs.length === 0) ungrouped.projects.push(project);
    else
      for (const ref of new Map(refs.map((r) => [r.id, r])).values())
        ensure(ref).projects.push(project);
  }
  const groups = [...nodes.values()]
    .filter((g) => !opts.hideEmpty || g.projects.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return ungrouped.projects.length > 0 ? [...groups, ungrouped] : groups;
}

/** Số dự án ĐANG HIỆN của từng nhóm (theo id); nhóm không có dự án nào không có khoá. */
export function groupCounts(projects: readonly ProjectDto[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of projects)
    for (const id of new Set((p.programs ?? []).map((r) => r.id)))
      counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Chữ cột "Nhóm": "N nhóm", 0 → "—". */
export function groupCountLabel(n: number): string {
  return n > 0 ? `${n} nhóm` : '—';
}
