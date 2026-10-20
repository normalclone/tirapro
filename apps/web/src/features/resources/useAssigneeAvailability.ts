import { useCallback, useMemo, useState } from 'react';
import type { PersonHint } from '@/components/ui/PersonOptionRow';
import { fmtDayMonth, toDateInput } from '@/lib/dateFormat';
import { useAuth } from '@/stores/auth';
import { useWorkload } from './api';
import { availabilityHint, issueWeekStart, weekEndOf } from './capacity';

/** Số liệu tải đổi chậm: dùng lại trong 1 phút khi mở lại danh sách (không nạp lại theo từng lần mở). */
const STALE_MS = 60_000;

/**
 * "Còn trống ~N giờ/tuần" cạnh từng người trong ô chọn người phụ trách (181). Rải `{...availability}` vào `<PeoplePicker>`.
 *
 * - Chỉ nạp khi danh sách ĐANG MỞ và người dùng có `workspace:view` (quyền của `GET /resources/workload`); thiếu quyền hoặc
 *   chưa có dữ liệu → không hiện gì, không báo lỗi.
 * - MỘT lần gọi mỗi lần mở (khoá chỉ phụ thuộc tuần, không phụ thuộc từ khoá tìm): toàn bộ người × MỘT tuần.
 * - KHÔNG truyền `projectId`: tham số đó lọc cả phân bổ lẫn việc theo dự án nên "còn trống" sẽ cao ảo; ở đây cần tải tổng.
 * - Tuần = tuần (thứ Hai) của hạn → ngày bắt đầu → tuần hiện tại, cùng định nghĩa tuần với máy chủ (xem `capacity.ts`).
 */
export function useAssigneeAvailability(
  issue: { dueDate?: string | null; startDate?: string | null } = {},
) {
  const canView = useAuth((s) => s.can('workspace:view'));
  const [open, setOpen] = useState(false);
  const week = useMemo(
    () =>
      issueWeekStart(
        { dueDate: issue.dueDate, startDate: issue.startDate },
        toDateInput(new Date()),
      ),
    [issue.dueDate, issue.startDate],
  );
  const { data } = useWorkload(
    { from: week, to: week },
    { enabled: canView && open, staleTime: STALE_MS },
  );

  const byUser = useMemo(() => {
    const m = new Map<string, PersonHint>();
    for (const row of data?.rows ?? []) {
      const h = availabilityHint(row.weeks.find((w) => w.weekStart === week));
      if (h) m.set(row.user.id, h);
    }
    return m;
  }, [data, week]);

  const hintFor = useCallback((userId: string) => byUser.get(userId) ?? null, [byUser]);
  const footerNote =
    byUser.size > 0
      ? `Còn trống = giờ làm được − giờ việc được giao, tuần ${fmtDayMonth(week)}–${fmtDayMonth(weekEndOf(week))}. Ước lượng, chỉ tính việc bạn xem được.`
      : null;
  return { onOpenChange: setOpen, hintFor, footerNote };
}
