import { describe, expect, it } from 'vitest';
import { pickSubmit } from './submitShortcut';

const ev = (
  o: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>,
) => ({
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...o,
});
const main = () => 'main';
const alt = () => 'alt';

describe('pickSubmit — Cmd/Ctrl+Enter (+Shift)', () => {
  it('không phải Enter hoặc thiếu Cmd/Ctrl → không làm gì', () => {
    expect(pickSubmit(ev({ key: 'a', ctrlKey: true }), { onSubmit: main })).toBeNull();
    expect(pickSubmit(ev({}), { onSubmit: main, onSubmitAlt: alt })).toBeNull();
    expect(pickSubmit(ev({ shiftKey: true }), { onSubmit: main, onSubmitAlt: alt })).toBeNull();
  });
  it('Cmd/Ctrl+Enter → hành động chính (Cmd hoặc Ctrl)', () => {
    expect(pickSubmit(ev({ ctrlKey: true }), { onSubmit: main, onSubmitAlt: alt })).toBe(main);
    expect(pickSubmit(ev({ metaKey: true }), { onSubmit: main, onSubmitAlt: alt })).toBe(main);
  });
  it('Cmd/Ctrl+Shift+Enter → hành động phụ khi có; KHÔNG rơi về hành động chính', () => {
    expect(
      pickSubmit(ev({ ctrlKey: true, shiftKey: true }), { onSubmit: main, onSubmitAlt: alt }),
    ).toBe(alt);
    expect(
      pickSubmit(ev({ metaKey: true, shiftKey: true }), { onSubmit: main, onSubmitAlt: alt }),
    ).toBe(alt);
  });
  it('không có hành động phụ → Shift giữ hành vi cũ (hộp thoại khác không đổi)', () => {
    expect(pickSubmit(ev({ ctrlKey: true, shiftKey: true }), { onSubmit: main })).toBe(main);
  });
  it('không có hành động nào → null', () => {
    expect(pickSubmit(ev({ ctrlKey: true }), {})).toBeNull();
    expect(pickSubmit(ev({ ctrlKey: true, shiftKey: true }), {})).toBeNull();
  });
});
