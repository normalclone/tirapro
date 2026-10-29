import { describe, expect, it } from 'vitest';
import { keyboardInset, mobileWindowStyle, shouldRefocus } from './layout';

describe('keyboardInset', () => {
  it('không bàn phím: visualViewport = cửa sổ', () => expect(keyboardInset(800, 800, 0)).toBe(0));
  it('thanh địa chỉ co giãn (<120px) không tính là bàn phím', () =>
    expect(keyboardInset(800, 740, 0)).toBe(0));
  it('bàn phím ảo che đáy → chiều cao bàn phím', () =>
    expect(keyboardInset(800, 480, 0)).toBe(320));
  it('layout viewport bị cuộn (offsetTop) được trừ ra', () =>
    expect(keyboardInset(800, 440, 40)).toBe(320));
});

describe('mobileWindowStyle', () => {
  it('neo PHẢI ở mọi trạng thái (không có left → không dính trái ở 640–1023px)', () => {
    for (const minimized of [true, false]) {
      const s = mobileWindowStyle({ minimized, inset: 0, offsetTop: 0 });
      expect(s.right).toBe(8);
      expect('left' in s).toBe(false);
    }
  });
  it('không bàn phím: nằm trên thanh tab đáy', () => {
    expect(mobileWindowStyle({ minimized: false, inset: 0, offsetTop: 0 }).bottom).toContain(
      '56px',
    );
  });
  it('có bàn phím: neo trên bàn phím, đỉnh theo offsetTop', () => {
    expect(mobileWindowStyle({ minimized: false, inset: 320, offsetTop: 12 })).toMatchObject({
      bottom: 328,
      top: 20,
    });
  });
  it('thu nhỏ: không có top (chỉ neo đáy)', () => {
    expect('top' in mobileWindowStyle({ minimized: true, inset: 0, offsetTop: 0 })).toBe(false);
  });
});

describe('shouldRefocus (focus sau Cmd+K)', () => {
  const body = { id: 'body' } as unknown as Element;
  const inside = { id: 'in' } as unknown as Element;
  const outside = { id: 'out' } as unknown as Element;
  const win = { contains: (n: Node) => (n as unknown) === inside };
  it('focus ở body/null → kéo về ô nhập', () => {
    expect(shouldRefocus(null, body, win)).toBe(true);
    expect(shouldRefocus(body, body, win)).toBe(true);
  });
  it('người dùng đã focus phần tử khác (trong hay ngoài cửa sổ), hoặc cửa sổ chưa có → để yên', () => {
    expect(shouldRefocus(inside, body, win)).toBe(false);
    expect(shouldRefocus(outside, body, win)).toBe(false);
    expect(shouldRefocus(null, body, null)).toBe(false);
  });
});
