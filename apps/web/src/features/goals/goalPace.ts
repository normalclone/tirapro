import type { ObjectiveStatus } from './api';

/**
 * Giá trị vạch "kỳ vọng theo thời gian" trên thanh tiến độ: chỉ mục tiêu ĐANG CHẠY mới có (bản nháp chưa bắt đầu,
 * đã đóng không còn "đáng ra" tới đâu). Kỳ tự do (null) hoặc API cũ chưa có trường (undefined) → không vạch.
 */
export function paceTarget(
  status: ObjectiveStatus,
  expectedProgress: number | null | undefined,
): number | undefined {
  return status === 'ACTIVE' && typeof expectedProgress === 'number' ? expectedProgress : undefined;
}
