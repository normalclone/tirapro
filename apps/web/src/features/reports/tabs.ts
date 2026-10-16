import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ReportTabId = 'sprint' | 'overview' | 'flow' | 'qa';

export interface ReportTab {
  id: ReportTabId;
  label: string;
  hint?: string;
}

/**
 * Các tab của trang Báo cáo, theo thứ tự hiển thị. Tab "Sprint" đứng đầu (mặc định).
 */
export const REPORT_TABS: ReportTab[] = [
  { id: 'sprint', label: 'Sprint', hint: 'Burndown, Velocity và tóm tắt từng sprint' },
  { id: 'overview', label: 'Tổng quan', hint: 'Phân bố công việc và khối lượng theo người' },
  { id: 'flow', label: 'Luồng công việc', hint: 'Cumulative Flow và tốc độ tạo / xử lý' },
  {
    id: 'qa',
    label: 'QA',
    hint: 'Chất lượng (QA): bug đang mở theo mức nghiêm trọng, tỷ lệ mở lại, thời gian đóng, theo phiên bản',
  },
];

const DEFAULT_TAB: ReportTabId = 'sprint';

/** `?tab=` → tab hợp lệ trong danh sách; giá trị lạ/thiếu → `sprint`. */
export function parseReportTab(raw: string | null, tabs: ReportTab[] = REPORT_TABS): ReportTabId {
  return tabs.find((t) => t.id === raw)?.id ?? DEFAULT_TAB;
}

/**
 * Tab đang mở, lưu trong URL (`?tab=`) để chia sẻ/tải lại đúng chỗ. Đổi tab bỏ `?sprint=` (chỉ tab Sprint dùng)
 * và thay thế mục lịch sử thay vì chồng thêm, để nút Quay lại không phải bấm qua từng tab.
 */
export function useReportTab(): [ReportTabId, (tab: ReportTabId) => void] {
  const [params, setParams] = useSearchParams();
  const tab = parseReportTab(params.get('tab'));
  const setTab = useCallback(
    (next: ReportTabId) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('tab', next);
          if (next !== 'sprint') p.delete('sprint');
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [tab, setTab];
}
