import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth-token';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:4000';

let socket: Socket | null = null;

/** Socket singleton — gửi access token hiện tại mỗi lần (re)connect. */
export function getSocket(): Socket {
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
