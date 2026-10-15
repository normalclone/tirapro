import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomTarget, ServerToClientEvents } from '@tirapro/shared';
import { getAccessToken } from './auth-token';

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
  }
  return socket;
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

/** Ngắt kết nối (vd khi đăng xuất) để socket cũ không giữ phiên/room của người dùng trước. */
export function disconnectSocket(): void {
  // Registry room gắn với socket cũ → bỏ luôn, các hàm release còn sót sẽ thành no-op.
  rooms.clear();
  roomsBoundTo = null;
  if (socket) {
    socket.disconnect();
    // Bỏ singleton: lần đăng nhập sau tạo socket mới, không thừa kế listener/room cũ.
    socket.removeAllListeners();
    socket = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('tirapro:logout', disconnectSocket);
}
