import { pollPlan } from '@/features/integrations/telegramWizard';

/** Một phiên liên kết: mã máy chủ vừa cấp + thời điểm bắt đầu hỏi (để tính lịch hỏi). */
export interface LinkSession<T extends { expiresAt: string }> {
  code: T;
  startedAt: number;
}

export type LinkPhase = 'creating' | 'waiting' | 'paused' | 'linked' | 'expired' | 'error';

/**
 * Giai đoạn hiển thị khi chờ người dùng gõ mã: máy chủ báo kết quả cuối (linked/expired/error) thì theo đó; mã hết hạn thì
 * `expired`; hết lịch hỏi tự động (180 giây) mà mã còn hạn thì `paused` (hiện nút "Kiểm tra lại"), còn lại `waiting`.
 */
export function linkPhase(input: {
  hasSession: boolean;
  pollStatus: 'waiting' | 'linked' | 'expired' | 'error' | undefined;
  expiresAtMs: number;
  startedAt: number;
  now: number;
}): LinkPhase {
  if (!input.hasSession) return 'creating';
  if (input.pollStatus === 'linked') return 'linked';
  if (input.pollStatus === 'error') return 'error';
  if (input.pollStatus === 'expired' || input.now >= input.expiresAtMs) return 'expired';
  return pollPlan(input.startedAt, input.now).continue ? 'waiting' : 'paused';
}

/** Loại sự kiện kênh Telegram của dự án nhận được (khớp `CHANNEL_EVENT_TYPES` phía máy chủ). */
export const CHANNEL_EVENT_LABELS: Record<string, { label: string; hint: string }> = {
  STATUS_CHANGED: { label: 'Đổi trạng thái', hint: 'Việc chuyển sang trạng thái khác' },
  ISSUE_UPDATED: { label: 'Việc được cập nhật', hint: 'Thông tin việc được chỉnh sửa' },
  COMMENT_ADDED: { label: 'Bình luận mới', hint: 'Có bình luận mới trên việc' },
};

/** Tóm tắt sự kiện của kênh. Rỗng (hoặc đủ mọi loại) = tất cả. */
export function channelEventsSummary(events: string[], all: string[]): string {
  if (events.length === 0 || all.every((e) => events.includes(e))) return 'Tất cả sự kiện';
  return all
    .filter((e) => events.includes(e))
    .map((e) => CHANNEL_EVENT_LABELS[e]?.label ?? e)
    .join(', ');
}

/**
 * Danh sách `events` mới khi bật/tắt một loại. Lưu `[]` (= tất cả) khi chọn đủ mọi loại; trả `null` nếu thao tác làm trống
 * danh sách (vì `[]` nghĩa là TẤT CẢ — không được để người dùng tưởng đã tắt hết mà thực ra nhận hết).
 */
export function nextChannelEvents(
  current: string[],
  all: string[],
  type: string,
  checked: boolean,
): string[] | null {
  const selected = new Set(current.length === 0 ? all : current);
  if (checked) selected.add(type);
  else selected.delete(type);
  if (selected.size === 0) return null;
  const next = all.filter((e) => selected.has(e));
  return next.length === all.length ? [] : next;
}

/** Loại có ô Telegram dùng được khi nào: chỉ khi đã liên kết (chưa liên kết → công tắc mờ kèm gợi ý). */
export function telegramToggleHint(linked: boolean): string {
  return linked
    ? 'Gửi vào chat Telegram của bạn, kể cả khi tắt thông báo trong ứng dụng'
    : 'Liên kết Telegram ở mục phía trên để bật';
}
