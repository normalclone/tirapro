import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  formatOklch,
  inSrgbGamut,
  oklabDistance,
  oklchToHex,
  parseHex,
  parseOklch,
} from './oklch';

describe('oklch ↔ sRGB', () => {
  it('trắng và đen', () => {
    expect(oklchToHex([1, 0, 0])).toBe('#ffffff');
    expect(oklchToHex([0, 0, 0])).toBe('#000000');
  });
  it('mốc đã biết: oklch(0.628 0.2577 29.23) ≈ đỏ #ff0000', () => {
    expect(oklchToHex([0.628, 0.2577, 29.23])).toBe('#ff0000');
  });
  it('gam: màu bão hoà quá mức nằm ngoài sRGB', () => {
    expect(inSrgbGamut([0.52, 0.16, 262])).toBe(true);
    expect(inSrgbGamut([0.7, 0.4, 150])).toBe(false);
  });
});

describe('parseHex', () => {
  it('#rrggbb, #rgb, không phân biệt hoa/thường', () => {
    expect(parseHex('#3263C3')).toEqual([0x32, 0x63, 0xc3]);
    expect(parseHex('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
  });
  it('không phải hex → null (không ném lỗi)', () => {
    for (const v of [
      '',
      'red',
      '#12',
      '#12345',
      '#gggggg',
      '#3263c3ff',
      'oklch(0.5 0.1 20)',
      null,
      undefined,
    ])
      expect(parseHex(v as string)).toBeNull();
  });
});

describe('parseOklch / formatOklch', () => {
  it('đọc và ghi lại đúng dạng của globals.css', () => {
    expect(parseOklch('oklch(0.52 0.16 262)')).toEqual([0.52, 0.16, 262]);
    expect(formatOklch([0.52, 0.16, 262])).toBe('oklch(0.52 0.16 262)');
  });
  it('sai dạng / có alpha → null', () => {
    for (const v of ['', 'oklch(0.5 0.1)', 'oklch(0.5 0.1 20 / 0.5)', '#fff', 'var(--x)', null])
      expect(parseOklch(v as string)).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('đen/trắng = 21, cùng màu = 1, đối xứng', () => {
    expect(contrastRatio([0, 0, 0], [1, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([0.5, 0.1, 20], [0.5, 0.1, 20])).toBeCloseTo(1, 5);
    const a = contrastRatio([0.3, 0.05, 100], [0.9, 0.02, 100]);
    expect(contrastRatio([0.9, 0.02, 100], [0.3, 0.05, 100])).toBeCloseTo(a, 8);
  });
});

describe('oklabDistance', () => {
  it('0 với chính nó; đỏ gần cam hơn xanh', () => {
    expect(oklabDistance([200, 0, 0], [200, 0, 0])).toBe(0);
    expect(oklabDistance([220, 40, 40], [230, 100, 20])).toBeLessThan(
      oklabDistance([220, 40, 40], [40, 80, 220]),
    );
  });
});
