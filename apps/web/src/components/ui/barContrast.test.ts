import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseOklch, type Oklch } from '@/lib/oklch';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const css = read('src/styles/globals.css');

const block = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};
const printBlock = (): string => {
  const start = css.indexOf(':root,\n  :root.dark {');
  return css.slice(start, css.indexOf('\n  }', start));
};
const themes: Record<string, string> = {
  light: block(':root'),
  dark: block('.dark'),
  print: printBlock(),
};
const tok = (theme: string, name: string): Oklch => {
  const v = parseOklch(new RegExp(`--${name}: ([^;]+);`).exec(themes[theme]!)?.[1]);
  if (!v) throw new Error(`không đọc được --${name} (${theme})`);
  return v;
};

// Màu thanh phải ≥ 3:1 (WCAG 1.4.11 — thành phần giao diện không phải chữ) trên nền chứa nó VÀ trên rãnh của thanh.
// BulletBar: rãnh `bg-border` trên `bg-surface`. LimitMeter: rãnh `bg-border-strong`, nằm trên surface (header sprint)
// hoặc surface-3 (cột Bảng việc).
const BULLET_FILLS = [
  'primary',
  'status-progress',
  'status-done',
  'warning-fill',
  'danger',
  'muted',
];
const LIMIT_FILLS = ['muted', 'warning-fill', 'danger'];

describe('màu thanh đủ tương phản phi-chữ (≥ 3:1) — sáng, tối, in', () => {
  for (const theme of Object.keys(themes)) {
    for (const fill of BULLET_FILLS) {
      it(`BulletBar ${fill} (${theme}) trên surface và trên rãnh border`, () => {
        expect(contrastRatio(tok(theme, fill), tok(theme, 'surface'))).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(tok(theme, fill), tok(theme, 'border'))).toBeGreaterThanOrEqual(3);
      });
    }
    for (const fill of LIMIT_FILLS) {
      it(`LimitMeter ${fill} (${theme}) trên surface, surface-3 và rãnh border-strong`, () => {
        for (const bg of ['surface', 'surface-3', 'border-strong']) {
          expect(contrastRatio(tok(theme, fill), tok(theme, bg))).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});

describe('token --warning-fill được nối đủ chỗ', () => {
  it('có trong tailwind, DESIGN.md và cả 3 khối token', () => {
    expect(read('tailwind.config.ts')).toMatch(/'warning-fill': token\('--warning-fill'\)/);
    expect(read('../../DESIGN.md')).toMatch(/--warning-fill/);
    for (const t of Object.keys(themes)) expect(themes[t]).toMatch(/--warning-fill:/);
  });
  it('BulletBar/LimitMeter tô thanh cảnh báo bằng warning-fill, không phải warning (chỉ ~2.4:1)', () => {
    for (const f of ['src/components/ui/BulletBar.tsx', 'src/components/ui/LimitMeter.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/bg-warning-fill/);
      expect(src, f).not.toMatch(/bg-warning(?!-fill)/);
    }
  });
});
