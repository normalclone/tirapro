import type { AiFallbackReason } from '@tirapro/shared';

/** Nhãn nguồn khi AI chưa bật/cấu hình — nói thẳng để người dùng không tưởng đây là kết quả của AI. */
export const HEURISTIC_LABEL = 'Gợi ý cơ bản (chưa cấu hình AI)';

/**
 * Nhãn nguồn của một kết quả AI.
 * `heuristic` KHÔNG kèm `reason` = AI sẵn sàng nhưng tác vụ không cần gọi → nhãn trung tính, không nhắc cấu hình.
 */
export function aiSourceLabel(source: 'claude' | 'heuristic', reason?: AiFallbackReason): string {
  if (source === 'claude') return 'Claude';
  return reason === 'unconfigured' ? HEURISTIC_LABEL : 'Gợi ý cơ bản';
}

/** Lời nhắc dưới kết quả heuristic: chưa cấu hình → nhờ quản trị; AI bận → thử lại; không lý do → null. */
export function aiFallbackNote(reason?: AiFallbackReason): string | null {
  if (!reason) return null;
  if (reason === 'unconfigured')
    return 'AI chưa được bật hoặc chưa cấu hình, nên đây là gợi ý cơ bản. Nhờ quản trị hệ thống thêm khoá AI (ANTHROPIC_API_KEY) để AI tách và chọn chính xác hơn.';
  return 'AI đang bận nên đây là gợi ý cơ bản. Bạn có thể bấm thử lại.';
}
