import type { IssueDto } from '@tirapro/types';
import { useCanEditSchedule } from '@/features/projects/permissions';

/**
 * Story points/Hạn/Ngày bắt đầu: một luật "đổi lịch" (`useCanEditSchedule`) áp cho cả trang chi tiết và panel xem
 * nhanh — sửa được công việc này VÀ là người tạo/báo cáo hoặc quản trị (khớp API).
 */
export function useCanEditRestricted(issue: IssueDto | undefined): boolean {
  const canSchedule = useCanEditSchedule(issue?.projectId);
  return !!issue && canSchedule(issue);
}
