import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomTarget, ServerToClientEvents } from '@tirapro/shared';
import { getAccessToken } from './auth-token';
import { refreshAccessToken } from './api';
import {
  attemptAfterSession,
  connReduce,
  INITIAL_CONN,
  nextRetry,
  type ConnEvent,
  type ConnState,
  type RetryReason,
} from './connectionState';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:4000';

/** Socket có kiểu theo hợp đồng chung với máy chủ (`@tirapro/shared`) — sai tên/payload event là lỗi biên dịch. */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/** Socket singleton — gửi access token hiện tại mỗi lần (re)connect. */
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(WS_URL, {
      path: '/realtime',
      autoConnect: false,
      transports: ['websocket'],
      auth: (cb) => cb({ token: getAccessToken() ?? '' }),
    });
    bindStatus(socket);
  }
  return socket;
}

/* ------------------------------------------------------------------ */
/* Trạng thái kết nối (091) — store nhỏ cho banner                      */
/* ------------------------------------------------------------------ */

let connState: ConnState = { ...INITIAL_CONN };
const connListeners = new Set<() => void>();

/** Nạp một sự kiện vào máy trạng thái thuần; chỉ báo cho UI khi trạng thái thật sự đổi. */
function dispatchConn(e: ConnEvent): void {
  const next = connReduce(connState, e);
  if (next === connState) return;
  const changed = (Object.keys(next) as (keyof ConnState)[]).some((k) => next[k] !== connState[k]);
  if (!changed) return;
  connState = next;
  connListeners.forEach((l) => l());
}

const subscribeConn = (l: () => void) => {
  connListeners.add(l);
  return () => {
    connListeners.delete(l);
  };
};
const getConn = () => connState;

/** Trạng thái thô (mốc mất/nối lại, tab ẩn…) cho `ConnectionBanner`. */
export function useConnectionState(): ConnState {
  return useSyncExternalStore(subscribeConn, getConn, getConn);
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
/** Đang chờ làm mới token (tránh chạy hai vòng quyết định chồng nhau). */
let retrying = false;
/** Thời điểm kết nối hiện tại được dựng (để đo "sống bao lâu trước khi rớt"); null khi đang đứt. */
let upAt: number | null = null;
/** Lý do nối lại đang chờ mạng quay lại — `online` sẽ chạy lại quyết định. */
let waitingOnline: RetryReason | null = null;

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retrying = false;
  waitingOnline = null;
  upAt = null;
}

/**
 * socket.io KHÔNG tự nối lại khi máy chủ chủ động ngắt (`io server disconnect` = kick phân quyền: token hỏng/hết hạn, phiên bị
 * thu hồi, bị gỡ khỏi dự án) hay khi middleware từ chối lúc nối (`socket.active === false`). Ta tự nối lại, nhưng THẬN TRỌNG:
 * làm mới token trước (single-flight `refreshAccessToken`; thất bại → dừng), chờ có mạng, lùi dần, trần MAX_RETRIES và
 * bộ đếm chỉ reset khi kết nối trước đó giữ ổn định (xem `nextRetry`). Hết lượt → `gave_up` → banner ổn định + nút "Tải lại".
 */
async function scheduleRetry(s: AppSocket, reason: RetryReason, stableMs: number): Promise<void> {
  if (retryTimer || retrying || s !== socket) return;
  const base = { reason, attempt: retryAttempt, stableMs, online: navigator.onLine };
  const apply = (d: ReturnType<typeof nextRetry>): boolean => {
    if (d === 'wait-online') waitingOnline = reason;
    else if (d === 'stop') dispatchConn({ type: 'gave_up' });
    else {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (s !== socket || s.connected) return;
        // Mạng tắt trong lúc chờ → không nối (sẽ thất bại và tốn lượt); chờ sự kiện `online`.
        if (!navigator.onLine) {
          waitingOnline = reason;
          return;
        }
        retryAttempt += 1;
        s.connect();
      }, d.delayMs);
      return true;
    }
    return false;
  };
  // Kiểm mạng/trần trước khi tốn một lần làm mới token.
  const pre = nextRetry({ ...base, refreshed: true });
  if (pre === 'wait-online' || pre === 'stop') {
    apply(pre);
    return;
  }
  retrying = true;
  const refreshed = (await refreshAccessToken().catch(() => null)) !== null;
  retrying = false;
  if (s !== socket) return; // đã đăng xuất / socket mới trong lúc chờ
  apply(nextRetry({ ...base, online: navigator.onLine, refreshed }));
}

function bindStatus(s: AppSocket): void {
  s.on('connect', () => {
    // KHÔNG reset retryAttempt ở đây: bị kick = connect rồi rớt ngay; chỉ reset khi kết nối đã sống ≥ STABLE_RETRY_MS.
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    waitingOnline = null;
    upAt = Date.now();
    dispatchConn({ type: 'connect', at: upAt });
  });
  s.on('disconnect', (reason) => {
    const now = Date.now();
    const stableMs = upAt === null ? 0 : now - upAt;
    upAt = null;
    // Phiên đã ổn định thì bộ đếm về 0 BẤT KỂ lý do rớt (vd `transport close` sau phiên dài không để lại bộ đếm cũ cho lần kick sau).
    retryAttempt = attemptAfterSession(retryAttempt, stableMs);
    dispatchConn({ type: 'disconnect', at: now, reason });
    if (reason === 'io server disconnect') void scheduleRetry(s, reason, stableMs);
  });
  s.on('connect_error', () => {
    dispatchConn({ type: 'connect_error', at: Date.now() });
    if (!s.active) void scheduleRetry(s, 'connect_error', 0);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    dispatchConn({ type: 'online', at: Date.now() });
    // Đang chờ mạng để nối lại thủ công → chạy lại quyết định ngay khi có mạng.
    if (waitingOnline && socket) {
      const reason = waitingOnline;
      waitingOnline = null;
      void scheduleRetry(socket, reason, 0);
    }
  });
  window.addEventListener('offline', () => dispatchConn({ type: 'offline', at: Date.now() }));
  document.addEventListener('visibilitychange', () =>
    dispatchConn({ type: 'visibility', at: Date.now(), hidden: document.hidden }),
  );
  // Trạng thái mạng/tab thật ngay từ đầu (module có thể nạp khi đã offline hoặc tab nền).
  connState = { ...connState, online: navigator.onLine, hidden: document.hidden };
}

/* ------------------------------------------------------------------ */
/* Registry room dùng chung (đếm tham chiếu)                           */
/* ------------------------------------------------------------------ */

interface RoomEntry {
  target: RoomTarget;
  count: number;
  /** Đã gửi `subscribe` ít nhất một lần → lần `connect` kế tiếp là NỐI LẠI. */
  joined: boolean;
  reconnectCbs: Set<() => void>;
}

const rooms = new Map<string, RoomEntry>();
let roomsBoundTo: AppSocket | null = null;
const roomKey = (t: RoomTarget) => `${t.kind}:${t.id}`;

function emitSubscribe(s: AppSocket, e: RoomEntry): void {
  s.emit('subscribe', e.target, (res) => {
    // FORBIDDEN: không có quyền vào room → không nhận realtime, dữ liệu vẫn tải bình thường qua REST.
    if (!res.ok) console.warn(`[realtime] không vào được room ${roomKey(e.target)}: ${res.error}`);
  });
}

/** Mỗi lần (re)connect: vào lại mọi room đang được giữ; room đã vào trước đó thì báo "nối lại" để bù event lỡ. */
function onSocketConnect(): void {
  const s = getSocket();
  rooms.forEach((e) => {
    const reconnect = e.joined;
    e.joined = true;
    emitSubscribe(s, e);
    if (reconnect) e.reconnectCbs.forEach((cb) => cb());
  });
}

/**
 * Vào room và trả hàm rời room. socket.io room là một SET nên mọi nơi cần cùng room
 * (ProjectLayout, PresenceAvatars, trang chi tiết issue...) PHẢI dùng chung registry này:
 * chỉ `subscribe` ở người đầu tiên và `unsubscribe` khi người CUỐI CÙNG rời đi.
 * `onReconnect` được gọi mỗi khi socket nối lại (đã vào room trước đó) để bù event đã lỡ.
 */
export function acquireRoom(target: RoomTarget, onReconnect?: () => void): () => void {
  const s = getSocket();
  if (roomsBoundTo !== s) {
    roomsBoundTo = s;
    s.on('connect', onSocketConnect);
  }
  const k = roomKey(target);
  let entry = rooms.get(k);
  if (!entry) {
    entry = { target, count: 0, joined: false, reconnectCbs: new Set() };
    rooms.set(k, entry);
  }
  const mine = entry;
  mine.count += 1;
  if (onReconnect) mine.reconnectCbs.add(onReconnect);

  if (s.connected) {
    if (!mine.joined) {
      mine.joined = true;
      emitSubscribe(s, mine);
    }
  } else {
    // Chưa kết nối thì chờ sự kiện `connect` (handler dùng chung sẽ vào mọi room).
    s.connect();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (rooms.get(k) !== mine) return; // registry đã bị reset (đăng xuất)
    if (onReconnect) mine.reconnectCbs.delete(onReconnect);
    mine.count -= 1;
    if (mine.count > 0) return;
    rooms.delete(k);
    if (s.connected) s.emit('unsubscribe', mine.target);
  };
}

/**
 * Nối lại socket hiện có bằng access token MỚI (không đổi singleton, giữ registry room → tự vào lại room khi `connect`).
 * Dùng sau khi token đổi mà phiên vẫn tiếp tục (vd tự đổi mật khẩu: token cũ bị thu hồi, máy chủ kiểm lại mốc thu hồi
 * ở mỗi lần subscribe nên socket mang token cũ sẽ không vào được room mới).
 */
export function reconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

/** Ngắt kết nối (vd khi đăng xuất) để socket cũ không giữ phiên/room của người dùng trước. */
export function disconnectSocket(): void {
  clearRetry();
  retryAttempt = 0;
  // Registry room gắn với socket cũ → bỏ luôn, các hàm release còn sót sẽ thành no-op.
  rooms.clear();
  roomsBoundTo = null;
  if (socket) {
    socket.disconnect();
    // Bỏ singleton: lần đăng nhập sau tạo socket mới, không thừa kế listener/room cũ.
    socket.removeAllListeners();
    socket = null;
  }
  // Quên lịch sử nối: ở trang đăng nhập / sau đăng xuất không có banner.
  dispatchConn({ type: 'reset' });
}

if (typeof window !== 'undefined') {
  window.addEventListener('tirapro:logout', disconnectSocket);
}
