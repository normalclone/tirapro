/**
 * Máy trạng thái THUẦN cho banner kết nối realtime (091): sự kiện + thời điểm vào → trạng thái; trạng thái + giờ → banner.
 * Không đụng socket/DOM để test được; `lib/socket.ts` giữ store và nạp sự kiện thật.
 */

/** Mất kết nối quá ngưỡng này mới hiện banner (tránh nháy khi nối lại nhanh). */
export const LOST_AFTER_MS = 3000;
/** "Đã kết nối lại" hiện bấy lâu rồi ẩn. */
export const RESTORED_MS = 2000;

export interface ConnState {
  /** Đã nối thành công ít nhất một lần — trước đó KHÔNG bao giờ hiện banner (khởi động nguội). */
  everConnected: boolean;
  /** `navigator.onLine`. */
  online: boolean;
  /** Socket.io đang nối. */
  socketUp: boolean;
  /** Tab đang ẩn. */
  hidden: boolean;
  /** Mốc bắt đầu mất đường truyền (socket đứt HOẶC mất mạng); null = đang ổn. */
  lostAt: number | null;
  /** Mốc nối lại sau lần mất đã đủ dài để banner từng hiện; null = không có gì để báo. */
  restoredAt: number | null;
}

export const INITIAL_CONN: ConnState = {
  everConnected: false,
  online: true,
  socketUp: false,
  hidden: false,
  lostAt: null,
  restoredAt: null,
};

export type ConnEvent =
  | { type: 'connect'; at: number }
  | { type: 'disconnect'; at: number; reason: string }
  | { type: 'connect_error'; at: number }
  | { type: 'online'; at: number }
  | { type: 'offline'; at: number }
  | { type: 'visibility'; at: number; hidden: boolean }
  | { type: 'reset' };

export type BannerPhase = 'hidden' | 'paused' | 'offline' | 'restored';

const linkUp = (s: Pick<ConnState, 'socketUp' | 'online'>) => s.socketUp && s.online;

/** Áp chuyển trạng thái đường truyền (ổn ↔ mất) lên mốc `lostAt`/`restoredAt`. */
function settle(prev: ConnState, next: ConnState, at: number): ConnState {
  if (!next.everConnected) return next;
  const was = linkUp(prev);
  const now = linkUp(next);
  if (was && !now) return { ...next, lostAt: at, restoredAt: null };
  if (!was && now) {
    const shown = prev.lostAt !== null && at - prev.lostAt > LOST_AFTER_MS;
    return { ...next, lostAt: null, restoredAt: shown ? at : null };
  }
  // Đang mất mà chưa có mốc (vd connect_error đầu tiên sau lần nối) → đặt mốc, KHÔNG dời mốc đã có.
  if (!now && next.lostAt === null) return { ...next, lostAt: at };
  return next;
}

export function connReduce(s: ConnState, e: ConnEvent): ConnState {
  switch (e.type) {
    case 'connect':
      return settle(s, { ...s, socketUp: true, everConnected: true }, e.at);
    case 'disconnect':
      return settle(s, { ...s, socketUp: false }, e.at);
    case 'connect_error':
      return settle(s, { ...s }, e.at);
    case 'online':
      return settle(s, { ...s, online: true }, e.at);
    case 'offline':
      return settle(s, { ...s, online: false }, e.at);
    case 'visibility': {
      const next = { ...s, hidden: e.hidden };
      // Quay lại tab khi đang mất: cho thêm một khoảng chờ (socket thường nối lại ngay lúc tab thức dậy).
      if (!e.hidden && s.lostAt !== null) next.lostAt = e.at;
      return next;
    }
    case 'reset':
      // Đăng xuất: quên lịch sử nối; giữ sự thật về mạng/tab.
      return { ...INITIAL_CONN, online: s.online, hidden: s.hidden };
  }
}

export function deriveBanner(s: ConnState, now: number): BannerPhase {
  if (!s.everConnected || s.hidden) return 'hidden';
  if (s.lostAt !== null) {
    if (now - s.lostAt <= LOST_AFTER_MS) return 'hidden';
    return s.online ? 'paused' : 'offline';
  }
  if (s.restoredAt !== null && now - s.restoredAt < RESTORED_MS) return 'restored';
  return 'hidden';
}

/** Còn bao nhiêu ms tới lần đổi pha kế tiếp (để hẹn giờ vẽ lại); null = không có gì sắp đổi. */
export function nextChangeIn(s: ConnState, now: number): number | null {
  if (!s.everConnected || s.hidden) return null;
  if (s.lostAt !== null) {
    const left = LOST_AFTER_MS - (now - s.lostAt);
    return left >= 0 ? left + 1 : null;
  }
  if (s.restoredAt !== null) {
    const left = RESTORED_MS - (now - s.restoredAt);
    return left > 0 ? left + 1 : null;
  }
  return null;
}

/**
 * socket.io KHÔNG tự nối lại khi máy chủ chủ động ngắt (`io server disconnect`) hoặc khi middleware từ chối lúc nối
 * (`socket.active === false`) → ta tự nối lại với độ trễ tăng dần, để chữ "đang thử lại" trên banner là thật.
 */
export const retryDelayMs = (attempt: number): number => Math.min(30_000, 2000 * 2 ** attempt);
