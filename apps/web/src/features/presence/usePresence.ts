import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PresenceUser, RoomTarget, TypingPayload } from '@tirapro/shared';
import { acquireRoom, getSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';

/** Server coi entry presence quá 60s là hết hạn → gửi heartbeat mỗi 25s (xem PresenceService). */
const HEARTBEAT_MS = 25_000;
/** Tự tắt chỉ báo "đang nhập" nếu 5s không nhận lại tín hiệu (người kia mất mạng/đóng tab). */
const TYPING_EXPIRE_MS = 5_000;
/** Composer gửi lại `typing:start` tối đa mỗi 2s và `typing:stop` sau 2s ngừng gõ. */
const TYPING_DEBOUNCE_MS = 2_000;

const EMPTY: PresenceUser[] = [];

const projectRoom = (id: string) => `project:${id}`;
const issueRoom = (id: string) => `issue:${id}`;

// ---------- Kho presence dùng chung (một listener socket cho mọi component) ----------
const state = new Map<string, PresenceUser[]>();
const storeListeners = new Set<() => void>();
let activeRefs = 0;
let handlersAttached = false;

function emitChange(): void {
  storeListeners.forEach((l) => l());
}

function setRoom(room: string, users: PresenceUser[]): void {
  state.set(room, users);
  emitChange();
}

const onState = (p: { room: string; users: PresenceUser[] }) => setRoom(p.room, p.users);
const onJoin = (p: { room: string; user: PresenceUser }) =>
  setRoom(p.room, [
    ...(state.get(p.room) ?? EMPTY).filter((u) => u.userId !== p.user.userId),
    p.user,
  ]);
const onLeave = (p: { room: string; userId: string }) =>
  setRoom(
    p.room,
    (state.get(p.room) ?? EMPTY).filter((u) => u.userId !== p.userId),
  );
/** Mất kết nối → danh sách cũ không còn đáng tin; subscribe lại sẽ nhận `presence:state` mới. */
const onDisconnect = () => {
  state.clear();
  emitChange();
};

function attachHandlers(): void {
  if (handlersAttached) return;
  handlersAttached = true;
  const s = getSocket();
  s.on('presence:state', onState);
  s.on('presence:join', onJoin);
  s.on('presence:leave', onLeave);
  s.on('disconnect', onDisconnect);
}

function detachHandlers(): void {
  if (!handlersAttached) return;
  handlersAttached = false;
  const s = getSocket();
  s.off('presence:state', onState);
  s.off('presence:join', onJoin);
  s.off('presence:leave', onLeave);
  s.off('disconnect', onDisconnect);
  state.clear();
}

/**
 * Vào room qua registry dùng chung (`acquireRoom`) — cùng room với `useProjectRealtime` nên
 * rời một nơi không làm nơi kia mất subscribe. Mất kết nối → registry tự subscribe lại và server
 * gửi `presence:state` mới. Listener presence chỉ gắn khi còn ít nhất một người dùng hook.
 */
function acquire(target: RoomTarget): () => void {
  attachHandlers();
  activeRefs += 1;
  const releaseRoom = acquireRoom(target);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseRoom();
    activeRefs -= 1;
    if (activeRefs <= 0) {
      activeRefs = 0;
      detachHandlers();
    }
  };
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

/**
 * Người đang trực tuyến trong dự án (không tính chính mình).
 * - `usePresence(projectId)`: mọi người đang mở dự án.
 * - `usePresence(projectId, issueId)`: chỉ những người đang xem công việc đó; hook này cũng báo
 *   "tôi đang xem công việc này" (và gỡ khi rời trang).
 * Vào/rời room theo vòng đời component, heartbeat 25s để không bị coi là đã rời.
 */
export function usePresence(projectId: string | undefined, issueId?: string): PresenceUser[] {
  const meId = useAuth((s) => s.user?.id);
  const room = projectId ? projectRoom(projectId) : null;
  const viewing = issueId ? issueRoom(issueId) : null;

  const users = useSyncExternalStore(
    subscribeStore,
    () => (room ? (state.get(room) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );

  const viewingRef = useRef(viewing);
  useEffect(() => {
    viewingRef.current = viewing;
  }, [viewing]);

  // Vào/rời room dự án + heartbeat — KHÔNG phụ thuộc `viewing` để đổi công việc không làm rời/vào lại room.
  useEffect(() => {
    if (!projectId) return;
    const release = acquire({ kind: 'project', id: projectId });
    const s = getSocket();
    const beat = () => {
      if (s.connected) s.emit('presence:view', { room: viewingRef.current });
    };
    s.on('connect', beat);
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      s.off('connect', beat);
      release();
    };
  }, [projectId]);

  // Báo đang xem công việc nào; rời trang thì trả về null.
  useEffect(() => {
    if (!projectId || !viewing) return;
    const s = getSocket();
    s.emit('presence:view', { room: viewing });
    return () => {
      s.emit('presence:view', { room: null });
    };
  }, [projectId, viewing]);

  const others = users.filter((u) => u.userId !== meId);
  if (!viewing) return others;
  return others.filter((u) => u.viewing === viewing);
}

export interface Typer {
  userId: string;
  displayName: string;
}

/** Danh sách người đang nhập bình luận ở một công việc (không tính mình), tự hết hạn sau 5s. */
export function useTypers(issueId: string | undefined): Typer[] {
  const meId = useAuth((s) => s.user?.id);
  const [typers, setTypers] = useState<Typer[]>([]);

  useEffect(() => {
    if (!issueId) return;
    const room = issueRoom(issueId);
    const release = acquire({ kind: 'issue', id: issueId });
    const s = getSocket();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const drop = (userId: string) => {
      const t = timers.get(userId);
      if (t) clearTimeout(t);
      timers.delete(userId);
      setTypers((cur) => cur.filter((x) => x.userId !== userId));
    };
    const onTyping = (p: TypingPayload & { typing: boolean }) => {
      if (p.room !== room || p.userId === meId) return;
      if (!p.typing) return drop(p.userId);
      const prev = timers.get(p.userId);
      if (prev) clearTimeout(prev);
      timers.set(
        p.userId,
        setTimeout(() => drop(p.userId), TYPING_EXPIRE_MS),
      );
      setTypers((cur) =>
        cur.some((x) => x.userId === p.userId)
          ? cur
          : [...cur, { userId: p.userId, displayName: p.displayName }],
      );
    };
    s.on('typing', onTyping);
    return () => {
      s.off('typing', onTyping);
      timers.forEach((t) => clearTimeout(t));
      setTypers([]);
      release();
    };
  }, [issueId, meId, setTypers]);

  return typers;
}

/**
 * Cho composer bình luận: gọi `notifyTyping()` mỗi lần gõ (tự giới hạn 2s/lần), `stopTyping()` khi gửi/xoá hết.
 * Ngừng gõ 2s hoặc rời trang thì tự gửi `typing:stop`.
 */
export function useTypingEmitter(issueId: string | undefined): {
  notifyTyping: () => void;
  stopTyping: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStart = useRef(0);
  const active = useRef(false);

  const stopTyping = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!active.current || !issueId) return;
    active.current = false;
    lastStart.current = 0;
    getSocket().emit('typing:stop', { room: issueRoom(issueId) });
  }, [issueId]);

  const notifyTyping = useCallback(() => {
    if (!issueId) return;
    const now = Date.now();
    if (!active.current || now - lastStart.current >= TYPING_DEBOUNCE_MS) {
      active.current = true;
      lastStart.current = now;
      getSocket().emit('typing:start', { room: issueRoom(issueId) });
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(stopTyping, TYPING_DEBOUNCE_MS);
  }, [issueId, stopTyping]);

  // Cần ở trong room issue thì server mới relay `typing`; đồng thời dọn khi rời trang.
  useEffect(() => {
    if (!issueId) return;
    const release = acquire({ kind: 'issue', id: issueId });
    return () => {
      stopTyping();
      release();
    };
  }, [issueId, stopTyping]);

  return { notifyTyping, stopTyping };
}
