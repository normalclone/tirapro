import type { Integration } from './api';

/** Lối vào wizard cho nơi khác (checklist onboarding): trang tự mở wizard rồi bỏ tham số khỏi URL. */
export const TELEGRAM_WIZARD_HREF = '/connect/integrations?wizard=telegram';

export type WizardStep = 'bot' | 'addToGroup' | 'linking' | 'test';

export const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: 'bot', label: 'Chọn bot' },
  { id: 'addToGroup', label: 'Thêm bot vào nhóm' },
  { id: 'linking', label: 'Liên kết nhóm' },
  { id: 'test', label: 'Gửi thử' },
];

export type WizardEvent =
  | 'BOT_READY'
  | 'GROUP_ADDED'
  | 'LINKED'
  | 'LINK_ERROR'
  | 'LINK_EXPIRED'
  | 'BACK';

/** Chuyển bước. Lỗi/hết hạn ở bước liên kết giữ nguyên bước; sự kiện không hợp lệ ở bước hiện tại bị bỏ qua. */
export function nextStep(step: WizardStep, event: WizardEvent): WizardStep {
  if (step === 'bot' && event === 'BOT_READY') return 'addToGroup';
  if (step === 'addToGroup' && event === 'GROUP_ADDED') return 'linking';
  if (step === 'linking') {
    if (event === 'LINKED') return 'test';
    if (event === 'BACK') return 'addToGroup';
  }
  return step;
}

/** Lệnh gõ trong nhóm. Có @TenBot vì bot (privacy mode) chỉ nhận lệnh gọi đích danh trong nhóm. */
export function linkCommand(botUsername: string | null, code: string): string {
  return botUsername ? `/link@${botUsername} ${code}` : `/link ${code}`;
}

/** Link mở Telegram để chọn nhóm thêm bot vào. */
export function startGroupUrl(botUsername: string | null): string | null {
  return botUsername ? `https://t.me/${botUsername}?startgroup=true` : null;
}

const TOKEN_SHAPE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

export type TokenCheck = { ok: true; token: string } | { ok: false; message: string };

/** Kiểm dạng token trước khi gọi server (server mới là nơi xác thực thật qua getMe). */
export function validateTokenShape(raw: string): TokenCheck {
  const token = raw.trim();
  if (token === '') return { ok: false, message: 'Hãy dán token bot (lấy từ @BotFather).' };
  if (/\s/.test(token)) {
    return {
      ok: false,
      message: 'Token có khoảng trắng — hãy copy lại nguyên token từ @BotFather.',
    };
  }
  if (!TOKEN_SHAPE.test(token)) {
    return {
      ok: false,
      message: 'Token phải có dạng 123456789:ABC… — hãy copy lại từ @BotFather.',
    };
  }
  return { ok: true, token };
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 180_000;

/** Kế hoạch hỏi server xem mã đã được gõ trong nhóm chưa: mỗi 3 giây, tối đa 180 giây. */
export function pollPlan(
  startedAt: number,
  now: number,
): { continue: boolean; intervalMs: number; remainingMs: number } {
  const remainingMs = Math.max(0, POLL_MAX_MS - (now - startedAt));
  return { continue: remainingMs > 0, intervalMs: POLL_INTERVAL_MS, remainingMs };
}

/** "14:32" — thời gian còn lại của mã. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Wizard mở ở đâu: có kết nối "Chưa có kênh nhận tin" → tiếp tục ở bước 2; ngược lại bắt đầu mới. */
export function wizardEntry(integrations: Integration[]): {
  integrationId: string | undefined;
  step: WizardStep;
} {
  const pending = integrations.find((i) => i.health.state === 'NO_CHANNEL');
  return pending
    ? { integrationId: pending.id, step: 'addToGroup' }
    : { integrationId: undefined, step: 'bot' };
}
