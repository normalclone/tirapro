import { describe, expect, it } from 'vitest';
import { fadeMask, revealScrollLeft, scrollFadeState } from './scrollFade';

describe('scrollFadeState', () => {
  it('vừa khung: không mờ mép nào', () =>
    expect(scrollFadeState({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toEqual({
      start: false,
      end: false,
    }));
  it('đầu danh sách dài: chỉ mờ mép phải', () =>
    expect(scrollFadeState({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 })).toEqual({
      start: false,
      end: true,
    }));
  it('giữa: mờ cả hai', () =>
    expect(scrollFadeState({ scrollLeft: 100, clientWidth: 300, scrollWidth: 500 })).toEqual({
      start: true,
      end: true,
    }));
  it('cuối: chỉ mờ mép trái; sai số làm tròn dưới 2px không tính là còn nội dung', () => {
    expect(scrollFadeState({ scrollLeft: 200, clientWidth: 300, scrollWidth: 500 })).toEqual({
      start: true,
      end: false,
    });
    expect(scrollFadeState({ scrollLeft: 199.2, clientWidth: 300, scrollWidth: 500 }).end).toBe(
      false,
    );
  });
});

describe('fadeMask', () => {
  it('không mờ → none', () => expect(fadeMask({ start: false, end: false })).toBe('none'));
  it('mờ mép nào thì gradient mép đó', () => {
    expect(fadeMask({ start: false, end: true })).toContain('#000 0');
    expect(fadeMask({ start: true, end: false })).toContain('transparent 0');
    expect(fadeMask({ start: true, end: true })).toMatch(/transparent 0.*transparent 100%/);
  });
});

describe('revealScrollLeft', () => {
  const view = { scrollLeft: 100, clientWidth: 300 };
  it('mục đã nằm trong khung → null (không cuộn)', () =>
    expect(revealScrollLeft(view, { offsetLeft: 150, offsetWidth: 60 })).toBeNull());
  it('mục lệch trái → cuộn để mép trái mục cách mép khung `pad`', () =>
    expect(revealScrollLeft(view, { offsetLeft: 60, offsetWidth: 60 }, 16)).toBe(44));
  it('mục lệch phải → cuộn để mép phải mục cách mép khung `pad`', () =>
    expect(revealScrollLeft(view, { offsetLeft: 380, offsetWidth: 60 }, 16)).toBe(156));
  it('không cuộn âm', () =>
    expect(
      revealScrollLeft(
        { scrollLeft: 10, clientWidth: 300 },
        { offsetLeft: 0, offsetWidth: 40 },
        16,
      ),
    ).toBe(0));
  it('mục rộng hơn khung → ưu tiên mép trái', () =>
    expect(revealScrollLeft(view, { offsetLeft: 20, offsetWidth: 400 }, 8)).toBe(12));
});
