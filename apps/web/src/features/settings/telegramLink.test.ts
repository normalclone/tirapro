import { describe, expect, it } from 'vitest';
import {
  channelEventsSummary,
  linkPhase,
  nextChannelEvents,
  telegramToggleHint,
} from './telegramLink';

const ALL = ['STATUS_CHANGED', 'ISSUE_UPDATED', 'COMMENT_ADDED'];

describe('linkPhase', () => {
  const base = { hasSession: true, pollStatus: undefined, expiresAtMs: 1_000_000, startedAt: 0 };
  it('chưa có mã → creating', () => {
    expect(linkPhase({ ...base, hasSession: false, now: 0 })).toBe('creating');
  });
  it('kết quả cuối từ máy chủ thắng; mã hết hạn → expired', () => {
    expect(linkPhase({ ...base, pollStatus: 'linked', now: 5 })).toBe('linked');
    expect(linkPhase({ ...base, pollStatus: 'error', now: 5 })).toBe('error');
    expect(linkPhase({ ...base, pollStatus: 'expired', now: 5 })).toBe('expired');
    expect(linkPhase({ ...base, now: 1_000_000 })).toBe('expired');
  });
  it('đang trong lịch hỏi (180 giây) → waiting; hết lịch mà mã còn hạn → paused (hiện "Kiểm tra lại")', () => {
    expect(linkPhase({ ...base, pollStatus: 'waiting', now: 60_000 })).toBe('waiting');
    expect(linkPhase({ ...base, pollStatus: 'waiting', now: 181_000 })).toBe('paused');
  });
});

describe('sự kiện kênh', () => {
  it('rỗng hoặc đủ mọi loại = tất cả; ngược lại liệt kê nhãn theo thứ tự chuẩn', () => {
    expect(channelEventsSummary([], ALL)).toBe('Tất cả sự kiện');
    expect(channelEventsSummary([...ALL].reverse(), ALL)).toBe('Tất cả sự kiện');
    expect(channelEventsSummary(['COMMENT_ADDED', 'STATUS_CHANGED'], ALL)).toBe(
      'Đổi trạng thái, Bình luận mới',
    );
  });
  it('bỏ một loại khi đang "tất cả" → danh sách còn lại; chọn đủ lại → [] (tất cả)', () => {
    expect(nextChannelEvents([], ALL, 'ISSUE_UPDATED', false)).toEqual([
      'STATUS_CHANGED',
      'COMMENT_ADDED',
    ]);
    expect(
      nextChannelEvents(['STATUS_CHANGED', 'COMMENT_ADDED'], ALL, 'ISSUE_UPDATED', true),
    ).toEqual([]);
  });
  it('không cho làm trống (vì [] nghĩa là TẤT CẢ) → null', () => {
    expect(nextChannelEvents(['COMMENT_ADDED'], ALL, 'COMMENT_ADDED', false)).toBeNull();
  });
});

describe('telegramToggleHint', () => {
  it('chưa liên kết → bảo liên kết trước', () => {
    expect(telegramToggleHint(false)).toMatch(/Liên kết Telegram/);
    expect(telegramToggleHint(true)).toMatch(/chat Telegram/);
  });
});
