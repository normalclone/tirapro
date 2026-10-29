import { describe, expect, it } from 'vitest';
import { telegramHealth } from './telegram-health';

const base = {
  status: 'ACTIVE',
  hasOwnToken: true,
  globalAvailable: false,
  platformEnabled: true,
  channelCount: 1,
} as const;

describe('telegramHealth', () => {
  it('READY', () => {
    const h = telegramHealth(base);
    expect(h.state).toBe('READY');
    expect(h.label).toBe('Sẵn sàng');
  });
  it('PLATFORM_OFF thắng mọi trạng thái', () =>
    expect(telegramHealth({ ...base, platformEnabled: false, channelCount: 0 }).state).toBe(
      'PLATFORM_OFF',
    ));
  it('NO_BOT khi không token riêng và không bot chung', () =>
    expect(telegramHealth({ ...base, hasOwnToken: false }).state).toBe('NO_BOT'));
  it('dùng bot chung vẫn READY', () =>
    expect(telegramHealth({ ...base, hasOwnToken: false, globalAvailable: true }).state).toBe(
      'READY',
    ));
  it('NO_CHANNEL khi 0 kênh bật', () =>
    expect(telegramHealth({ ...base, channelCount: 0 }).state).toBe('NO_CHANNEL'));
  it('TOKEN_ERROR khi status ERROR (thắng NO_BOT/NO_CHANNEL)', () =>
    expect(
      telegramHealth({ ...base, status: 'ERROR', hasOwnToken: false, channelCount: 0 }).state,
    ).toBe('TOKEN_ERROR'));
  it('mỗi trạng thái có nhãn tiếng Việt và gợi ý việc cần làm', () => {
    const states = [
      telegramHealth(base),
      telegramHealth({ ...base, channelCount: 0 }),
      telegramHealth({ ...base, hasOwnToken: false }),
      telegramHealth({ ...base, status: 'ERROR' }),
      telegramHealth({ ...base, platformEnabled: false }),
    ];
    expect(states.map((s) => s.label)).toEqual([
      'Sẵn sàng',
      'Chưa có kênh nhận tin',
      'Chưa có bot',
      'Lỗi token',
      'Đang tắt toàn hệ thống',
    ]);
    for (const s of states) expect(s.hint.length).toBeGreaterThan(5);
  });
});
