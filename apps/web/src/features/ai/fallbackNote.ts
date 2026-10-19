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

/**
 * Lời nhắc dưới kết quả heuristic: chưa cấu hình → nhờ quản trị (admin hệ thống thấy tên biến môi trường cần đặt,
 * người khác chỉ thấy "liên hệ quản trị"); AI bận → thử lại; không lý do → null.
 */
export function aiFallbackNote(
  reason?: AiFallbackReason,
  audience: 'admin' | 'user' = 'admin',
): string | null {
  if (!reason) return null;
  if (reason === 'unconfigured')
    return audience === 'admin'
      ? 'AI chưa được bật hoặc chưa cấu hình, nên đây là gợi ý cơ bản. Hãy thêm khoá AI (ANTHROPIC_API_KEY) cho máy chủ để AI tách và chọn chính xác hơn.'
      : 'AI chưa được bật hoặc chưa cấu hình, nên đây là gợi ý cơ bản. Liên hệ quản trị hệ thống để bật AI.';
  return 'AI đang bận nên đây là gợi ý cơ bản. Bạn có thể thử lại sau ít phút.';
}
