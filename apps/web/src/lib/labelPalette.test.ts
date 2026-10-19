import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LABEL_PALETTE,
  findPaletteEntry,
  labelTone,
  paletteValue,
  type LabelPaletteKey,
} from './labelPalette';
import { contrastRatio, formatOklch, inSrgbGamut, oklchToHex, type Oklch } from './oklch';

const css = readFileSync(join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
const block = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};
const token = (theme: 'root' | 'dark', name: string): string | undefined =>
  new RegExp(`--${name}: ([^;]+);`).exec(block(theme === 'root' ? ':root' : '.dark'))?.[1];

// Nền trang/mặt phẳng của DESIGN.md (globals.css) — swatch/chấm phải ≥ 3:1 trên đó (WCAG 1.4.11).
const PAGE: Record<'light' | 'dark', Oklch[]> = {
  light: [
    [1, 0, 0],
    [0.985, 0.004, 250],
    [0.968, 0.005, 250],
  ],
  dark: [
    [0.17, 0.013, 256],
    [0.205, 0.014, 256],
    [0.235, 0.015, 256],
  ],
};

describe('LABEL_PALETTE', () => {
  it('đúng 8 màu, khoá/tên/hex không trùng, tên tiếng Việt', () => {
    expect(LABEL_PALETTE).toHaveLength(8);
    expect(new Set(LABEL_PALETTE.map((e) => e.key)).size).toBe(8);
    expect(new Set(LABEL_PALETTE.map((e) => e.hex)).size).toBe(8);
    expect(LABEL_PALETTE.map((e) => e.name)).toEqual([
      'Xanh dương',
      'Xanh lơ',
      'Xanh lá',
      'Vàng',
      'Cam',
      'Đỏ',
      'Tím',
      'Xám',
    ]);
  });
  it('hex lưu xuống API = sRGB của biến thể sáng, chữ thường #rrggbb', () => {
    for (const e of LABEL_PALETTE) {
      expect(e.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(inSrgbGamut(e.light)).toBe(true);
      expect(e.hex).toBe(oklchToHex(e.light));
    }
  });
  it('biến thể tối nằm trong gam sRGB', () => {
    for (const e of LABEL_PALETTE) expect(inSrgbGamut(e.dark)).toBe(true);
  });
});

describe('tương phản WCAG AA', () => {
  it.each(LABEL_PALETTE.map((e) => [e.key, e] as const))(
    '%s: chữ trên nền chip ≥ 4.5:1 ở cả hai giao diện',
    (_k, e) => {
      expect(contrastRatio(e.light, e.bgLight)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(e.dark, e.bgDark)).toBeGreaterThanOrEqual(4.5);
    },
  );
  it.each(LABEL_PALETTE.map((e) => [e.key, e] as const))(
    '%s: chấm/swatch ≥ 3:1 trên nền trang và các mặt phẳng',
    (_k, e) => {
      for (const bg of PAGE.light) expect(contrastRatio(e.light, bg)).toBeGreaterThanOrEqual(3);
      for (const bg of PAGE.dark) expect(contrastRatio(e.dark, bg)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe('token CSS khớp bảng màu (một nguồn sự thật)', () => {
  it.each(LABEL_PALETTE.map((e, i) => [e.key, e, i + 1] as const))(
    '%s ↔ token --label-N',
    (_k, e, n) => {
      expect(token('root', `label-${n}`)).toBe(formatOklch(e.light));
      expect(token('root', `label-${n}-bg`)).toBe(formatOklch(e.bgLight));
      expect(token('dark', `label-${n}`)).toBe(formatOklch(e.dark));
      expect(token('dark', `label-${n}-bg`)).toBe(formatOklch(e.bgDark));
    },
  );
});

describe('labelTone', () => {
  it('hex trong bảng màu (không phân biệt hoa/thường) → đúng tông, không "legacy"', () => {
    for (const e of LABEL_PALETTE) {
      for (const v of [e.hex, e.hex.toUpperCase()]) {
        const t = labelTone(v);
        expect(t.key).toBe(e.key);
        expect(t.legacy).toBe(false);
      }
    }
  });
  it('trả biến CSS (đúng giao diện nhờ .dark), không trả hex', () => {
    const t = labelTone(LABEL_PALETTE[2]!.hex);
    expect(t.fg).toBe('var(--label-3)');
    expect(t.bg).toBe('var(--label-3-bg)');
  });
  it('hex ngoài bảng màu (nhãn cũ) → tông gần nhất, đánh dấu legacy', () => {
    const cases: [string, LabelPaletteKey][] = [
      ['#ef4444', 'red'],
      ['#dc2626', 'red'],
      ['#22c55e', 'green'],
      ['#16a34a', 'green'],
      ['#a855f7', 'purple'],
      ['#3b82f6', 'blue'],
      ['#2563eb', 'blue'],
      ['#f97316', 'orange'],
      ['#eab308', 'yellow'],
      ['#06b6d4', 'cyan'],
      ['#6b7280', 'gray'],
      ['#000000', 'gray'],
      ['#ffffff', 'gray'],
    ];
    for (const [hex, key] of cases) {
      const t = labelTone(hex);
      expect(t.key, hex).toBe(key);
      expect(t.legacy, hex).toBe(true);
    }
  });
  it('#rgb ngắn và chuỗi OKLCH ngoài bảng màu cũng được ánh xạ', () => {
    expect(labelTone('#f00').key).toBe('red');
    expect(labelTone('oklch(0.55 0.20 25)').key).toBe('red');
    expect(labelTone('oklch(0.60 0.13 200)').key).toBe('cyan');
  });
  it('chuỗi OKLCH của chính bảng màu (vai trò) → đúng tông, không legacy', () => {
    for (const e of LABEL_PALETTE) {
      const t = labelTone(formatOklch(e.light));
      expect(t.key).toBe(e.key);
      expect(t.legacy).toBe(false);
    }
  });
  it('trống / sai định dạng → tông Xám trung tính, KHÔNG ném lỗi', () => {
    const junk = [
      null,
      undefined,
      '',
      '   ',
      'red',
      '#12',
      '#zzzzzz',
      'var(--primary)',
      'oklch(',
      '#12345678',
      '\u0000',
      42,
      {},
      [],
    ];
    for (const v of junk) {
      expect(() => labelTone(v as string)).not.toThrow();
      expect(labelTone(v as string).key).toBe('gray');
    }
  });
  it('mọi kết quả đều là một mục của bảng màu (không bao giờ chữ khó đọc)', () => {
    const keys = new Set(LABEL_PALETTE.map((e) => e.key));
    for (let i = 0; i < 300; i++) {
      const hex = `#${Math.floor(Math.random() * 0x1000000)
        .toString(16)
        .padStart(6, '0')}`;
      expect(keys.has(labelTone(hex).key)).toBe(true);
    }
  });
});

describe('findPaletteEntry / paletteValue', () => {
  it('hex: so khớp không phân biệt hoa/thường; lạ → null', () => {
    expect(findPaletteEntry('#C52B30', 'hex')?.key).toBe('red');
    expect(findPaletteEntry('#123456', 'hex')).toBeNull();
    expect(findPaletteEntry(null, 'hex')).toBeNull();
  });
  it('oklch: khớp chuỗi biến thể sáng; chuỗi vai trò cũ → null', () => {
    expect(findPaletteEntry('oklch(0.54 0.19 25)', 'oklch')?.key).toBe('red');
    expect(findPaletteEntry('oklch(0.55 0.20 25)', 'oklch')).toBeNull();
  });
  it('giá trị gửi API: hex chữ thường hoặc chuỗi oklch', () => {
    const red = LABEL_PALETTE.find((e) => e.key === 'red')!;
    expect(paletteValue(red, 'hex')).toBe('#c52b30');
    expect(paletteValue(red, 'oklch')).toBe('oklch(0.54 0.19 25)');
  });
});
