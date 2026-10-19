import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connReduce,
  deriveBanner,
  INITIAL_CONN,
  LOST_AFTER_MS,
  nextChangeIn,
  RESTORED_MS,
  retryDelayMs,
  type ConnEvent,
  type ConnState,
} from './connectionState';

const run = (events: ConnEvent[], from: ConnState = INITIAL_CONN) =>
  events.reduce(connReduce, from);
const connected = run([{ type: 'connect', at: 0 }]);

describe('trước lần nối đầu tiên', () => {
  it('không bao giờ hiện banner, dù lỗi nối hay mất mạng', () => {
    const s = run([
      { type: 'connect_error', at: 100 },
      { type: 'offline', at: 200 },
      { type: 'connect_error', at: 300 },
    ]);
    expect(s.everConnected).toBe(false);
    expect(deriveBanner(s, 60_000)).toBe('hidden');
  });
});

describe('mất kết nối realtime (mạng vẫn còn)', () => {
  const lost = run([{ type: 'disconnect', at: 1000, reason: 'transport close' }], connected);
  it('chưa quá 3s → không hiện (tránh nháy)', () => {
    expect(deriveBanner(lost, 1000 + LOST_AFTER_MS)).toBe('hidden');
  });
  it('quá 3s → "paused" (cập nhật tạm dừng, không nói lưu lỗi)', () => {
    expect(deriveBanner(lost, 1000 + LOST_AFTER_MS + 1)).toBe('paused');
  });
  it('connect_error liên tiếp không đặt lại mốc mất kết nối', () => {
    const s = run(
      [
        { type: 'connect_error', at: 2000 },
        { type: 'connect_error', at: 4000 },
      ],
      lost,
    );
    expect(s.lostAt).toBe(1000);
    expect(deriveBanner(s, 4500)).toBe('paused');
  });
  it('server chủ động ngắt (io server disconnect) vẫn tính là mất kết nối', () => {
    const s = run([{ type: 'disconnect', at: 0, reason: 'io server disconnect' }], connected);
    expect(deriveBanner(s, 5000)).toBe('paused');
  });
  it('nối lại sau khi banner đã hiện → "restored" 2s rồi ẩn', () => {
    const s = run([{ type: 'connect', at: 9000 }], lost);
    expect(deriveBanner(s, 9000)).toBe('restored');
    expect(deriveBanner(s, 9000 + RESTORED_MS - 1)).toBe('restored');
    expect(deriveBanner(s, 9000 + RESTORED_MS)).toBe('hidden');
  });
  it('nối lại TRONG 3s → không hiện gì (banner chưa từng hiện)', () => {
    const s = run([{ type: 'connect', at: 2500 }], lost);
    expect(deriveBanner(s, 2500)).toBe('hidden');
    expect(deriveBanner(s, 3000)).toBe('hidden');
  });
});

describe('mất mạng (navigator.onLine === false)', () => {
  it('offline → sau 3s hiện "offline", dù socket chưa kịp báo disconnect', () => {
    const s = run([{ type: 'offline', at: 1000 }], connected);
    expect(deriveBanner(s, 3500)).toBe('hidden');
    expect(deriveBanner(s, 4001)).toBe('offline');
  });
  it('mạng có lại mà socket còn nối → restored (nếu đã hiện)', () => {
    const s = run(
      [
        { type: 'offline', at: 1000 },
        { type: 'online', at: 8000 },
      ],
      connected,
    );
    expect(deriveBanner(s, 8000)).toBe('restored');
  });
  it('mạng có lại nhưng socket vẫn đứt → chuyển sang "paused", không phải "offline"', () => {
    const s = run(
      [
        { type: 'disconnect', at: 500, reason: 'transport close' },
        { type: 'offline', at: 1000 },
        { type: 'online', at: 8000 },
      ],
      connected,
    );
    expect(deriveBanner(s, 8500)).toBe('paused');
  });
});

describe('tab ẩn', () => {
  const lost = run([{ type: 'disconnect', at: 0, reason: 'ping timeout' }], connected);
  it('không hiện banner khi tab ẩn', () => {
    const s = run([{ type: 'visibility', at: 1000, hidden: true }], lost);
    expect(deriveBanner(s, 10_000)).toBe('hidden');
  });
  it('quay lại tab: cho thêm 3s trước khi hiện (không nháy lúc đang nối lại)', () => {
    const s = run(
      [
        { type: 'visibility', at: 1000, hidden: true },
        { type: 'visibility', at: 60_000, hidden: false },
      ],
      lost,
    );
    expect(deriveBanner(s, 61_000)).toBe('hidden');
    expect(deriveBanner(s, 63_500)).toBe('paused');
  });
  it('quay lại tab khi đang nối tốt thì không đổi gì', () => {
    const s = run([{ type: 'visibility', at: 5, hidden: false }], connected);
    expect(s.lostAt).toBeNull();
  });
});

describe('reset (đăng xuất)', () => {
  it('về trạng thái ban đầu — không banner ở trang đăng nhập', () => {
    const lost = run([{ type: 'disconnect', at: 0, reason: 'x' }], connected);
    const s = connReduce(lost, { type: 'reset' });
    expect(s).toEqual({ ...INITIAL_CONN, online: s.online });
    expect(deriveBanner(s, 99_999)).toBe('hidden');
  });
  it('giữ nguyên trạng thái mạng/tab thật khi reset', () => {
    const s = connReduce(run([{ type: 'offline', at: 1 }]), { type: 'reset' });
    expect(s.online).toBe(false);
  });
});

describe('nextChangeIn — hẹn giờ vẽ lại đúng lúc', () => {
  it('đang chờ 3s → còn bao lâu tới lúc hiện', () => {
    const s = run([{ type: 'disconnect', at: 1000, reason: 'x' }], connected);
    expect(nextChangeIn(s, 2000)).toBe(LOST_AFTER_MS - 1000 + 1);
  });
  it('đang hiện "restored" → còn bao lâu tới lúc ẩn', () => {
    const s = run(
      [
        { type: 'disconnect', at: 0, reason: 'x' },
        { type: 'connect', at: 5000 },
      ],
      connected,
    );
    expect(nextChangeIn(s, 5500)).toBe(RESTORED_MS - 500 + 1);
  });
  it('không có gì sắp đổi → null', () => {
    expect(nextChangeIn(connected, 10)).toBeNull();
    expect(nextChangeIn(INITIAL_CONN, 10)).toBeNull();
    const lostLong = run([{ type: 'disconnect', at: 0, reason: 'x' }], connected);
    expect(nextChangeIn(lostLong, 60_000)).toBeNull();
  });
});

describe('retryDelayMs — nối lại thủ công khi socket.io không tự nối', () => {
  it('lùi dần, trần 30s', () => {
    expect(retryDelayMs(0)).toBe(2000);
    expect(retryDelayMs(1)).toBe(4000);
    expect(retryDelayMs(2)).toBe(8000);
    expect(retryDelayMs(10)).toBe(30_000);
  });
});

describe('nối dây', () => {
  const WEB = join(__dirname, '../..');
  const src = (rel: string) => readFileSync(join(WEB, 'src', rel), 'utf8');
  it('socket.ts: store qua useSyncExternalStore, nghe connect/disconnect/connect_error + online/offline + visibility, reset khi đăng xuất', () => {
    const s = src('lib/socket.ts');
    expect(s).toContain('useSyncExternalStore');
    expect(s).toContain("on('connect'");
    expect(s).toContain("on('disconnect'");
    expect(s).toContain("on('connect_error'");
    expect(s).toContain("addEventListener('online'");
    expect(s).toContain("addEventListener('offline'");
    expect(s).toContain("addEventListener('visibilitychange'");
    expect(s).toContain("type: 'reset'");
    expect(s).toContain('export function useConnectionState');
  });
  it('AppShell đặt ConnectionBanner cạnh MaintenanceBanner (trong luồng, trên <main>)', () => {
    const a = src('components/layout/AppShell.tsx');
    expect(a).toMatch(/<MaintenanceBanner \/>\s*<ConnectionBanner \/>/);
    expect(a.indexOf('<ConnectionBanner />')).toBeLessThan(a.indexOf('<main'));
  });
  it('không có hàng đợi/persist, không nút "Tải lại"', () => {
    const b = src('components/layout/ConnectionBanner.tsx');
    expect(b).not.toMatch(/Tải lại|localStorage|indexedDB/i);
  });
});
