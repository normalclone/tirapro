import { describe, expect, it } from 'vitest';
import { HEALTH_TONE, lastTestLabel, testToast } from './telegramStatus';

describe('testToast', () => {
  it('NO_CHANNEL nói thiếu kênh, không nhắc token', () => {
    const t = testToast({ sent: 0, total: 0, enabled: true, ok: false, reason: 'NO_CHANNEL' });
    expect(t.text).toContain('Chưa có kênh nào');
    expect(t.text).not.toMatch(/token/i);
  });
  it('NO_BOT và PLATFORM_OFF có thông điệp riêng', () => {
    expect(
      testToast({ sent: 0, total: 0, enabled: false, ok: false, reason: 'NO_BOT' }).text,
    ).toContain('Chưa có bot');
    expect(
      testToast({ sent: 0, total: 0, enabled: true, ok: false, reason: 'PLATFORM_OFF' }).text,
    ).toContain('tắt toàn hệ thống');
  });
  it('gửi thiếu → cảnh báo kèm n/m và gợi ý kiểm tra bot còn trong nhóm', () => {
    const t = testToast({ sent: 1, total: 2, enabled: true, ok: false });
    expect(t.kind).toBe('warning');
    expect(t.text).toContain('Đã gửi 1/2');
    expect(t.text).toContain('còn trong nhóm');
  });
  it('gửi đủ → success', () => {
    expect(testToast({ sent: 2, total: 2, enabled: true, ok: true })).toMatchObject({
      kind: 'success',
    });
  });
});

describe('lastTestLabel', () => {
  it('null khi chưa thử', () => expect(lastTestLabel(null)).toBeNull());
  it('có ngày giờ và n/m', () => {
    const l = lastTestLabel({ at: '2026-10-15T09:12:00.000Z', ok: true, sent: 2, total: 2 });
    expect(l).toMatch(/^Gửi thử gần nhất .* — 2\/2$/);
  });
});

describe('HEALTH_TONE', () => {
  it('chỉ READY là xanh', () => {
    expect(HEALTH_TONE.READY).toBe('success');
    expect(HEALTH_TONE.NO_CHANNEL).not.toBe('success');
    expect(HEALTH_TONE.TOKEN_ERROR).toBe('danger');
  });
});
