/**
 * Máy trạng thái THUẦN cho banner kết nối realtime (091): sự kiện + thời điểm vào → trạng thái; trạng thái + giờ → banner.
 * Không đụng socket/DOM để test được; `lib/socket.ts` giữ store và nạp sự kiện thật.
 */

/** Mất kết nối quá ngưỡng này mới hiện banner (tránh nháy khi nối lại nhanh). */
export const LOST_AFTER_MS = 3000;
/** "Đã kết nối lại" hiện bấy lâu rồi ẩn. */
export const RESTORED_MS = 2000;
/**
 * Một lần nối lại chỉ được coi là XONG khi đường truyền giữ ổn định bấy lâu. Nối rồi rớt trong khoảng này (máy chủ kick, mạng
 * chập chờn) giữ NGUYÊN mốc mất kết nối ban đầu — không đặt lại đồng hồ 3s và không chớp "Đã kết nối lại".
 */
export const STABLE_UP_MS = 3000;
/** Kết nối vừa rồi sống ≥ bấy lâu thì bộ đếm nối lại thủ công về 0 (nối-rồi-rớt-ngay thì KHÔNG reset). */
export const STABLE_RETRY_MS = 15_000;
/** Số lần nối lại thủ công tối đa; hết lượt → dừng và báo bằng banner ổn định. */
export const MAX_RETRIES = 5;

export interface ConnState {
  /** Đã nối thành công ít nhất một lần — trước đó KHÔNG bao giờ hiện banner (khởi động nguội). */
  everConnected: boolean;
  /** `navigator.onLine`. */
  online: boolean;
  /** Socket.io đang nối. */
  socketUp: boolean;
  /** Tab đang ẩn. */
  hidden: boolean;
  /** Mốc bắt đầu mất đường truyền (socket đứt HOẶC mất mạng); null = đang ổn. Giữ nguyên qua các lần nối ngắn (xem STABLE_UP_MS). */
  lostAt: number | null;
  /** Mốc đường truyền vừa nối lại và chưa đủ ổn định (chỉ có khi `lostAt` còn); null = đang đứt hoặc đã ổn. */
  upSince: number | null;
  /** Lúc nối lại, banner đã đang hiện (đã mất > 3s) → khi ổn định phải báo "Đã kết nối lại"; chưa hiện thì im lặng. */
  upShown: boolean;
  /** Mốc bắt đầu cửa sổ "Đã kết nối lại"; null = không có gì để báo. */
  restoredAt: number | null;
  /** Hết lượt nối lại thủ công (hoặc làm mới token thất bại) → không còn tự thử nữa. */
  gaveUp: boolean;
}

export const INITIAL_CONN: ConnState = {
  everConnected: false,
  online: true,
  socketUp: false,
  hidden: false,
  lostAt: null,
  upSince: null,
  upShown: false,
  restoredAt: null,
  gaveUp: false,
};

export type ConnEvent =
  | { type: 'connect'; at: number }
  | { type: 'disconnect'; at: number; reason: string }
  | { type: 'connect_error'; at: number }
  | { type: 'online'; at: number }
  | { type: 'offline'; at: number }
  | { type: 'visibility'; at: number; hidden: boolean }
  | { type: 'gave_up' }
  | { type: 'reset' };

export type BannerPhase = 'hidden' | 'paused' | 'offline' | 'restored' | 'stopped';

const linkUp = (s: Pick<ConnState, 'socketUp' | 'online'>) => s.socketUp && s.online;

/**
 * Kết thúc lần nối lại nếu đã ổn định ≥ STABLE_UP_MS tính tới `now`: xoá mốc mất, và nếu banner đã hiện lúc nối lại thì mở cửa sổ
 * "Đã kết nối lại" bắt đầu từ lúc vừa đủ ổn định. Thuần theo thời gian → `deriveBanner` và `connReduce` dùng chung.
 */
function resolve(s: ConnState, now: number): ConnState {
  if (s.lostAt === null || s.upSince === null || now - s.upSince < STABLE_UP_MS) return s;
  return {
    ...s,
    lostAt: null,
    upSince: null,
    upShown: false,
    restoredAt: s.upShown ? s.upSince + STABLE_UP_MS : null,
  };
}

/** Áp chuyển trạng thái đường truyền (ổn ↔ mất) lên mốc `lostAt`/`upSince`. `prev` đã qua `resolve`. */
function settle(prev: ConnState, next: ConnState, at: number): ConnState {
  if (!next.everConnected) return next;
  const was = linkUp(prev);
  const now = linkUp(next);
  if (was && !now) {
    // Mất đường truyền. Đang trong cửa sổ "chưa ổn định" → giữ mốc gốc (chập chờn/bị kick không được đặt lại đồng hồ).
    return { ...next, lostAt: prev.lostAt ?? at, upSince: null, upShown: false, restoredAt: null };
  }
  if (!was && now && prev.lostAt !== null) {
    return { ...next, upSince: at, upShown: at - prev.lostAt > LOST_AFTER_MS, restoredAt: null };
  }
  // Đang mất mà chưa có mốc (vd connect_error đầu tiên sau lần nối) → đặt mốc, KHÔNG dời mốc đã có.
  if (!now && next.lostAt === null) return { ...next, lostAt: at };
  return next;
}

export function connReduce(prev: ConnState, e: ConnEvent): ConnState {
  if (e.type === 'reset') {
    // Đăng xuất: quên lịch sử nối; giữ sự thật về mạng/tab.
    return { ...INITIAL_CONN, online: prev.online, hidden: prev.hidden };
  }
  if (e.type === 'gave_up') return { ...prev, gaveUp: true };
  const s = resolve(prev, e.at);
  switch (e.type) {
    case 'connect':
      return settle(s, { ...s, socketUp: true, everConnected: true, gaveUp: false }, e.at);
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
      // Quay lại tab khi đang đứt: cho thêm một khoảng chờ (socket thường nối lại ngay lúc tab thức dậy).
      if (!e.hidden && s.lostAt !== null && s.upSince === null) next.lostAt = e.at;
      return next;
    }
  }
}

export function deriveBanner(raw: ConnState, now: number): BannerPhase {
  const s = resolve(raw, now);
  if (!s.everConnected || s.hidden) return 'hidden';
  if (s.lostAt !== null) {
    // Đã nối lại nhưng chưa ổn định: giữ nguyên cái đang hiện (chỉ hiện nếu lúc nối lại banner đã hiện).
    if (s.upSince !== null) return s.upShown ? 'paused' : 'hidden';
    if (s.gaveUp) return 'stopped';
    if (now - s.lostAt <= LOST_AFTER_MS) return 'hidden';
    return s.online ? 'paused' : 'offline';
  }
  if (s.restoredAt !== null && now - s.restoredAt < RESTORED_MS) return 'restored';
  return 'hidden';
}

/** Còn bao nhiêu ms tới lần đổi pha kế tiếp (để hẹn giờ vẽ lại); null = không có gì sắp đổi. */
export function nextChangeIn(raw: ConnState, now: number): number | null {
  const s = resolve(raw, now);
  if (!s.everConnected || s.hidden) return null;
  if (s.lostAt !== null) {
    if (s.upSince !== null) return Math.max(0, STABLE_UP_MS - (now - s.upSince)) + 1;
    const left = LOST_AFTER_MS - (now - s.lostAt);
    return !s.gaveUp && left >= 0 ? left + 1 : null;
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

export type RetryReason = 'io server disconnect' | 'connect_error';

/**
 * Quyết định nối lại THỦ CÔNG (socket.io chỉ tự nối lại khi mất đường truyền; máy chủ kick/middleware từ chối thì không):
 * - mạng tắt → `wait-online` (nối lại ở sự kiện `online`, không hẹn giờ);
 * - làm mới token thất bại → `stop` (phiên hỏng; interceptor REST lo đăng xuất — không lặp);
 * - kết nối vừa rồi sống ≥ STABLE_RETRY_MS → bộ đếm về 0; ngược lại (bị kick ngay sau `connect`) bộ đếm KHÔNG reset;
 * - hết MAX_RETRIES → `stop`; còn lượt → `{ delayMs }` lùi dần.
 * `refreshed`: kết quả `refreshAccessToken()` (gọi hàm này lần đầu với `true` để kiểm mạng/trần trước khi tốn một lần refresh).
 */
export function nextRetry(o: {
  reason: RetryReason;
  attempt: number;
  stableMs: number;
  online: boolean;
  refreshed: boolean;
}): { delayMs: number } | 'stop' | 'wait-online' {
  if (!o.online) return 'wait-online';
  if (!o.refreshed) return 'stop';
  const attempt = o.stableMs >= STABLE_RETRY_MS ? 0 : o.attempt;
  if (attempt >= MAX_RETRIES) return 'stop';
  return { delayMs: retryDelayMs(attempt) };
}
