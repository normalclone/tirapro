import { create } from 'zustand';
import type { RequestKind } from '@/features/intake/reportForm';

/** Ngữ cảnh mở form "Báo lỗi / Gửi yêu cầu". */
export interface ReportIssuePreset {
  /** Dự án đích (key); bỏ trống → dự án đang xem, không có thì người dùng tự chọn trong hộp. */
  projectKey?: string;
  kind?: RequestKind;
  summary?: string;
  description?: string;
}

interface ReportIssueModalState {
  open: boolean;
  preset: ReportIssuePreset;
  openReport: (preset?: ReportIssuePreset) => void;
  close: () => void;
}

/**
 * Điều khiển form "Báo lỗi / Gửi yêu cầu" toàn cục — MỘT form duy nhất cho mọi lối vào (Cmd+K, header board,
 * nút nổi, trang Việc mới vào, form Tạo việc). Gắn một lần ở khung ứng dụng (`router.tsx`).
 */
export const useReportIssueModal = create<ReportIssueModalState>((set) => ({
  open: false,
  preset: {},
  openReport: (preset = {}) => set({ open: true, preset }),
  close: () => set({ open: false }),
}));

/** Lối vào cho nơi không phải component (vd phím tắt/lệnh): `openReportIssue({ kind: 'BUG' })`. */
export const openReportIssue = (preset?: ReportIssuePreset): void =>
  useReportIssueModal.getState().openReport(preset);
