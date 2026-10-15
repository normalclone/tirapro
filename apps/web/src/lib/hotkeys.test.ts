import { describe, expect, it } from 'vitest';
import { isWorklogHotkey } from './hotkeys';

const ev = (
  over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => ({ key: 'w', metaKey: false, ctrlKey: false, altKey: false, ...over });
const ctx = (over: Partial<{ typing: boolean; dialogOpen: boolean; canLog: boolean }> = {}) => ({
  typing: false,
  dialogOpen: false,
  canLog: true,
  ...over,
});

describe('isWorklogHotkey', () => {
  it('w / W thường, có quyền, không gõ, không dialog → true', () => {
    expect(isWorklogHotkey(ev(), ctx())).toBe(true);
    expect(isWorklogHotkey(ev({ key: 'W' }), ctx())).toBe(true);
  });
  it('phím khác → false', () => expect(isWorklogHotkey(ev({ key: 'x' }), ctx())).toBe(false));
  it('có modifier (⌘W đóng tab…) → false', () => {
    expect(isWorklogHotkey(ev({ metaKey: true }), ctx())).toBe(false);
    expect(isWorklogHotkey(ev({ ctrlKey: true }), ctx())).toBe(false);
    expect(isWorklogHotkey(ev({ altKey: true }), ctx())).toBe(false);
  });
  it('đang gõ / có dialog mở / không có quyền → false', () => {
    expect(isWorklogHotkey(ev(), ctx({ typing: true }))).toBe(false);
    expect(isWorklogHotkey(ev(), ctx({ dialogOpen: true }))).toBe(false);
    expect(isWorklogHotkey(ev(), ctx({ canLog: false }))).toBe(false);
  });
});
