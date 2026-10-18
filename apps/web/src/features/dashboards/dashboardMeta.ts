import type { CustomDashboardSummaryDto } from '@tirapro/shared';

/** Nhãn ngắn của mức chia sẻ (huy hiệu cạnh tên dashboard). */
export function scopeBadge(
  d: Pick<CustomDashboardSummaryDto, 'scope' | 'project' | 'team'>,
): string {
  switch (d.scope) {
    case 'PRIVATE':
      return 'Riêng tư';
    case 'GLOBAL':
      return 'Cả không gian';
    case 'PROJECT':
      return d.project ? `Dự án ${d.project.key}` : 'Theo dự án';
    case 'TEAM':
      return d.team ? `Nhóm ${d.team.name}` : 'Theo nhóm';
  }
}

/** Câu giải thích ai xem được — hiện ở tiêu đề trang và trong hộp chọn mức chia sẻ. */
export function scopeDescription(
  d: Pick<CustomDashboardSummaryDto, 'scope' | 'project' | 'team'>,
): string {
  switch (d.scope) {
    case 'PRIVATE':
      return 'Chỉ mình chủ bảng tổng quan xem được';
    case 'GLOBAL':
      return 'Mọi thành viên không gian làm việc xem được';
    case 'PROJECT':
      return `Thành viên dự án ${d.project?.name ?? ''}`.trim();
    case 'TEAM':
      return `Thành viên nhóm ${d.team?.name ?? ''}`.trim();
  }
}

export interface DashboardGroup {
  /** Khoá ổn định của nhóm (dùng cho `key`). */
  id: string;
  title: string;
  items: CustomDashboardSummaryDto[];
}

/**
 * Nhóm danh sách theo MỨC CHIA SẺ cho bộ chọn: "Của tôi" (mọi dashboard do mình tạo, huy hiệu cho biết mức) → "Cả không
 * gian" → từng "Dự án: KEY" → từng "Nhóm: tên". Trong nhóm giữ thứ tự máy chủ trả (mới sửa trước); nhóm rỗng bị bỏ.
 */
export function groupDashboards(list: CustomDashboardSummaryDto[]): DashboardGroup[] {
  const mine: CustomDashboardSummaryDto[] = [];
  const global: CustomDashboardSummaryDto[] = [];
  const byProject = new Map<string, DashboardGroup>();
  const byTeam = new Map<string, DashboardGroup>();
  for (const d of list) {
    if (d.isMine) mine.push(d);
    else if (d.scope === 'GLOBAL') global.push(d);
    else if (d.scope === 'PROJECT' && d.project) {
      const g = byProject.get(d.project.id) ?? {
        id: `project:${d.project.id}`,
        title: `Dự án: ${d.project.key}`,
        items: [],
      };
      g.items.push(d);
      byProject.set(d.project.id, g);
    } else if (d.scope === 'TEAM' && d.team) {
      const g = byTeam.get(d.team.id) ?? {
        id: `team:${d.team.id}`,
        title: `Nhóm: ${d.team.name}`,
        items: [],
      };
      g.items.push(d);
      byTeam.set(d.team.id, g);
    }
  }
  const groups: DashboardGroup[] = [
    { id: 'mine', title: 'Của tôi', items: mine },
    { id: 'global', title: 'Cả không gian', items: global },
    ...[...byProject.values()].sort((a, b) => a.title.localeCompare(b.title, 'vi')),
    ...[...byTeam.values()].sort((a, b) => a.title.localeCompare(b.title, 'vi')),
  ];
  return groups.filter((g) => g.items.length > 0);
}
