import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@tirapro/shared';
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

/** Ngắt kết nối (vd khi đăng xuất) để socket cũ không giữ phiên/room của người dùng trước. */
export function disconnectSocket(): void {
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
