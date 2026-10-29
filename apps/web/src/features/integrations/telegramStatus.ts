import { fmtDateTime } from '@/lib/dateFormat';
import type { TelegramHealthState, TelegramLastTest, TestResult } from './api';

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted';

/** Màu nhãn theo trạng thái thật (READY xanh; thiếu bước tiếp theo vàng; lỗi đỏ; tắt hệ thống xám). */
export const HEALTH_TONE: Record<TelegramHealthState, StatusTone> = {
  READY: 'success',
  NO_CHANNEL: 'warning',
  NO_BOT: 'warning',
  TOKEN_ERROR: 'danger',
  PLATFORM_OFF: 'muted',
};

/** Thông điệp toast sau "Kiểm tra" — nêu đúng nguyên nhân thay vì "đã gửi 0/0". */
export function testToast(res: TestResult): { kind: 'success' | 'info' | 'warning'; text: string } {
  switch (res.reason) {
    case 'NO_CHANNEL':
      return { kind: 'info', text: 'Chưa có kênh nào — thêm kênh trước.' };
    case 'NO_BOT':
      return {
        kind: 'warning',
        text: 'Chưa có bot để gửi — xoá rồi kết nối lại bằng token bot của bạn.',
      };
    case 'PLATFORM_OFF':
      return {
        kind: 'warning',
        text: 'Tích hợp đang tắt toàn hệ thống — nhờ quản trị hệ thống bật lại.',
      };
    default:
      break;
  }
  if (res.ok)
    return { kind: 'success', text: `Đã gửi ${res.sent}/${res.total} — bot hoạt động tốt.` };
  return {
    kind: 'warning',
    text: `Đã gửi ${res.sent}/${res.total} — kiểm tra bot còn trong nhóm và được phép nhắn tin.`,
  };
}

/** "Gửi thử gần nhất 15/10/2026 09:12 — 2/2" (null nếu chưa thử). */
export function lastTestLabel(t: TelegramLastTest | null): string | null {
  if (!t) return null;
  return `Gửi thử gần nhất ${fmtDateTime(t.at)} — ${t.sent}/${t.total}`;
}
