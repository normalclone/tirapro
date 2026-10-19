import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connReduce,
  deriveBanner,
  INITIAL_CONN,
  LOST_AFTER_MS,
  MAX_RETRIES,
  nextChangeIn,
  nextRetry,
  RESTORED_MS,
  retryDelayMs,
  STABLE_RETRY_MS,
  STABLE_UP_MS,
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
  it('nối lại sau khi banner đã hiện: giữ "paused" tới khi kết nối ổn định ≥ STABLE_UP_MS, rồi "restored" 2s', () => {
    const s = run([{ type: 'connect', at: 9000 }], lost);
    expect(deriveBanner(s, 9000)).toBe('paused');
    expect(deriveBanner(s, 9000 + STABLE_UP_MS - 1)).toBe('paused');
    const at = 9000 + STABLE_UP_MS;
    expect(deriveBanner(s, at)).toBe('restored');
    expect(deriveBanner(s, at + RESTORED_MS - 1)).toBe('restored');
    expect(deriveBanner(s, at + RESTORED_MS)).toBe('hidden');
  });
  it('nối lại TRONG 3s (banner chưa từng hiện) → không hiện gì, kể cả sau khi ổn định', () => {
    const s = run([{ type: 'connect', at: 2500 }], lost);
    expect(deriveBanner(s, 2500)).toBe('hidden');
    expect(deriveBanner(s, 4500)).toBe('hidden');
    expect(deriveBanner(s, 2500 + STABLE_UP_MS + RESTORED_MS)).toBe('hidden');
  });
});

describe('đường truyền chập chờn (connect rồi rớt ngay) — không che giấu mất kết nối', () => {
  const kick = (from: ConnState, t: number) =>
    run(
      [
        { type: 'connect', at: t },
        { type: 'disconnect', at: t + 50, reason: 'io server disconnect' },
      ],
      from,
    );
  it('connect ngắn rồi rớt KHÔNG đặt lại mốc 3s: mốc gốc được giữ', () => {
    let s = run([{ type: 'disconnect', at: 1000, reason: 'transport close' }], connected);
    s = kick(s, 3000);
    s = kick(s, 7000);
    expect(s.lostAt).toBe(1000);
    expect(deriveBanner(s, 7100)).toBe('paused');
  });
  it('vòng lặp bị kick (mỗi 2s): banner hiện sau 3s kể từ lần mất đầu và KHÔNG chớp "restored"', () => {
    let s = run([{ type: 'disconnect', at: 0, reason: 'io server disconnect' }], connected);
    const phases: string[] = [];
    for (let t = 2000; t <= 20_000; t += 2000) {
      s = kick(s, t);
      phases.push(deriveBanner(s, t + 60), deriveBanner(s, t + 1000));
    }
    expect(phases).not.toContain('restored');
    expect(phases.slice(2)).toEqual(phases.slice(2).map(() => 'paused'));
  });
  it('nối lại và giữ ổn định ≥ STABLE_UP_MS thì mới coi là xong; rớt sau đó là mất kết nối MỚI (mốc mới)', () => {
    let s = run([{ type: 'disconnect', at: 0, reason: 'x' }], connected);
    s = connReduce(s, { type: 'connect', at: 5000 });
    s = connReduce(s, { type: 'disconnect', at: 5000 + STABLE_UP_MS + 10, reason: 'x' });
    expect(s.lostAt).toBe(5000 + STABLE_UP_MS + 10);
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
    expect(deriveBanner(s, 8000)).toBe('paused');
    expect(deriveBanner(s, 8000 + STABLE_UP_MS)).toBe('restored');
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
    // đang chờ ổn định: còn STABLE_UP_MS - 500 tới lúc đổi pha (sang "restored")
    expect(nextChangeIn(s, 5500)).toBe(STABLE_UP_MS - 500 + 1);
    // đã ổn định: còn bao lâu tới lúc ẩn
    const t = 5000 + STABLE_UP_MS + 500;
    expect(nextChangeIn(connReduce(s, { type: 'visibility', at: t, hidden: false }), t)).toBe(
      RESTORED_MS - 500 + 1,
    );
  });
  it('không có gì sắp đổi → null', () => {
    expect(nextChangeIn(connected, 10)).toBeNull();
    expect(nextChangeIn(INITIAL_CONN, 10)).toBeNull();
    const lostLong = run([{ type: 'disconnect', at: 0, reason: 'x' }], connected);
    expect(nextChangeIn(lostLong, 60_000)).toBeNull();
  });
});

describe('gave_up — hết lượt nối lại', () => {
  const lost = run([{ type: 'disconnect', at: 0, reason: 'io server disconnect' }], connected);
  it('hiện "stopped" (ổn định, không còn "đang thử lại")', () => {
    const s = connReduce(lost, { type: 'gave_up' });
    expect(deriveBanner(s, 60_000)).toBe('stopped');
  });
  it('nối lại được thì xoá gave_up', () => {
    const s = run([{ type: 'gave_up' }, { type: 'connect', at: 70_000 }], lost);
    expect(s.gaveUp).toBe(false);
  });
  it('reset (đăng xuất) xoá gave_up', () => {
    expect(connReduce(connReduce(lost, { type: 'gave_up' }), { type: 'reset' }).gaveUp).toBe(false);
  });
});

describe('nextRetry — quyết định nối lại thủ công (thuần)', () => {
  const base = {
    reason: 'io server disconnect' as const,
    attempt: 0,
    stableMs: 0,
    online: true,
    refreshed: true,
  };
  it('mạng tắt → chờ sự kiện online, không hẹn giờ', () => {
    expect(nextRetry({ ...base, online: false })).toBe('wait-online');
  });
  it('làm mới token thất bại → dừng (không lặp; interceptor REST lo đăng xuất)', () => {
    expect(nextRetry({ ...base, refreshed: false })).toBe('stop');
    expect(nextRetry({ ...base, reason: 'connect_error', refreshed: false })).toBe('stop');
  });
  it('lùi dần 2s,4s,8s,16s,30s; hết MAX_RETRIES → dừng', () => {
    const d = (attempt: number) => nextRetry({ ...base, attempt });
    expect(d(0)).toEqual({ delayMs: 2000 });
    expect(d(1)).toEqual({ delayMs: 4000 });
    expect(d(3)).toEqual({ delayMs: 16_000 });
    expect(d(4)).toEqual({ delayMs: 30_000 });
    expect(MAX_RETRIES).toBe(5);
    expect(d(MAX_RETRIES)).toBe('stop');
  });
  it('kết nối vừa rồi chỉ sống ngắn (bị kick) → bộ đếm KHÔNG reset, vẫn tiến tới trần', () => {
    expect(nextRetry({ ...base, attempt: MAX_RETRIES, stableMs: 100 })).toBe('stop');
    expect(nextRetry({ ...base, attempt: MAX_RETRIES, stableMs: STABLE_RETRY_MS - 1 })).toBe(
      'stop',
    );
  });
  it('kết nối vừa rồi giữ ≥ STABLE_RETRY_MS → coi như lần mới, bộ đếm về 0', () => {
    expect(nextRetry({ ...base, attempt: MAX_RETRIES, stableMs: STABLE_RETRY_MS })).toEqual({
      delayMs: 2000,
    });
  });
  it('thứ tự ưu tiên: offline thắng cả trần', () => {
    expect(nextRetry({ ...base, attempt: MAX_RETRIES, online: false })).toBe('wait-online');
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
  it('socket.ts: không reset bộ đếm ở `connect` trần, làm mới token trước khi nối lại, chờ online, báo gave_up', () => {
    const s = src('lib/socket.ts');
    expect(s).toContain('refreshAccessToken()');
    expect(s).toContain('nextRetry(');
    expect(s).toContain("type: 'gave_up'");
    expect(s).toContain('waitingOnline');
    expect(s).toMatch(/if \(!navigator\.onLine\) \{\s*waitingOnline = reason;/); // cả lúc hẹn giờ nổ
    const connectHandler = /s\.on\('connect', \(\) => \{[\s\S]*?\n  \}\);/.exec(s)?.[0] ?? '';
    expect(connectHandler).not.toMatch(/retryAttempt = 0/);
  });
  it('không có hàng đợi/persist; nút "Tải lại" chỉ ở trạng thái hết lượt (stopped)', () => {
    const b = src('components/layout/ConnectionBanner.tsx');
    expect(b).not.toMatch(/localStorage|indexedDB/i);
    expect(b.match(/<Button/g)?.length).toBe(1);
    expect(b).toMatch(/phase === 'stopped' && \(\s*<Button/);
    expect(b).toContain('variant="secondary"');
  });
});
