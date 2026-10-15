import { describe, expect, it } from 'vitest';
import {
  TELEGRAM_WIZARD_HREF,
  formatRemaining,
  linkCommand,
  nextStep,
  pollPlan,
  startGroupUrl,
  validateTokenShape,
  wizardEntry,
} from './telegramWizard';
import type { Integration } from './api';

describe('linkCommand / startGroupUrl', () => {
  it('ghép đúng cú pháp có @TenBot (bot trong nhóm chỉ nhận lệnh gọi đích danh)', () => {
    expect(linkCommand('TiraproBot', 'K7M2QX')).toBe('/link@TiraproBot K7M2QX');
    expect(startGroupUrl('TiraproBot')).toBe('https://t.me/TiraproBot?startgroup=true');
    expect(startGroupUrl(null)).toBeNull();
  });
  it('chưa biết tên bot → lệnh không có @', () => {
    expect(linkCommand(null, 'K7M2QX')).toBe('/link K7M2QX');
  });
});

describe('validateTokenShape', () => {
  const good = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
  it('token đúng dạng → ok, đã trim', () => {
    expect(validateTokenShape(`  ${good}\n`)).toEqual({ ok: true, token: good });
  });
  it('rỗng → nhắc dán token', () => {
    const r = validateTokenShape('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('dán token');
  });
  it('có khoảng trắng bên trong → từ chối, nói rõ', () => {
    const r = validateTokenShape('123456789:AAHdqTcvCH1vGWJxf SeofSAs0K5PALDsaw');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('khoảng trắng');
  });
  it('chuỗi lạ → từ chối kèm ví dụ dạng đúng', () => {
    for (const bad of ['hello', '123456789', 'abc:def', '123456789:short']) {
      const r = validateTokenShape(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('123456789:ABC');
    }
  });
});

describe('nextStep', () => {
  it('bot ok → addToGroup → linking → test', () => {
    expect(nextStep('bot', 'BOT_READY')).toBe('addToGroup');
    expect(nextStep('addToGroup', 'GROUP_ADDED')).toBe('linking');
    expect(nextStep('linking', 'LINKED')).toBe('test');
  });
  it('lỗi/hết hạn ở bước liên kết giữ nguyên bước', () => {
    expect(nextStep('linking', 'LINK_ERROR')).toBe('linking');
    expect(nextStep('linking', 'LINK_EXPIRED')).toBe('linking');
  });
  it('quay lại từ linking về addToGroup; sự kiện không hợp lệ giữ nguyên', () => {
    expect(nextStep('linking', 'BACK')).toBe('addToGroup');
    expect(nextStep('bot', 'LINKED')).toBe('bot');
    expect(nextStep('test', 'GROUP_ADDED')).toBe('test');
    expect(nextStep('addToGroup', 'BACK')).toBe('addToGroup');
  });
});

describe('pollPlan', () => {
  it('dừng sau 180s', () => {
    expect(pollPlan(0, 179_000).continue).toBe(true);
    expect(pollPlan(0, 181_000).continue).toBe(false);
  });
  it('khoảng hỏi 3 giây; còn lại tính đúng', () => {
    const p = pollPlan(1_000, 61_000);
    expect(p.intervalMs).toBe(3000);
    expect(p.remainingMs).toBe(120_000);
  });
});

describe('formatRemaining', () => {
  it('mm:ss, không âm', () => {
    expect(formatRemaining(872_000)).toBe('14:32');
    expect(formatRemaining(5_000)).toBe('0:05');
    expect(formatRemaining(-3)).toBe('0:00');
  });
});

describe('wizardEntry', () => {
  const mk = (id: string, state: Integration['health']['state']) =>
    ({ id, health: { state, label: '', hint: '' } }) as unknown as Integration;
  it('chưa có kết nối → bắt đầu ở bước 1', () => {
    expect(wizardEntry([])).toEqual({ integrationId: undefined, step: 'bot' });
  });
  it('có kết nối chưa có kênh → mở ở bước 2 với kết nối đó', () => {
    expect(wizardEntry([mk('a', 'READY'), mk('b', 'NO_CHANNEL')])).toEqual({
      integrationId: 'b',
      step: 'addToGroup',
    });
  });
  it('mọi kết nối đã đủ → tạo kết nối mới (bước 1)', () => {
    expect(wizardEntry([mk('a', 'READY')])).toEqual({ integrationId: undefined, step: 'bot' });
  });
});

describe('TELEGRAM_WIZARD_HREF', () => {
  it('là đường dẫn lối vào cho checklist onboarding', () => {
    expect(TELEGRAM_WIZARD_HREF).toBe('/connect/integrations?wizard=telegram');
  });
});
