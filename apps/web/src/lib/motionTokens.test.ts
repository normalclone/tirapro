import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(f)) out.push(p);
  }
  return out;
}

describe('motion tokens (DESIGN.md: fast=120ms base=180ms slow=240ms)', () => {
  it('tailwind.config có transitionDuration fast/base/slow', () => {
    const d = (config.theme?.extend as { transitionDuration?: Record<string, string> })
      .transitionDuration;
    expect(d).toEqual({ fast: '120ms', base: '180ms', slow: '240ms' });
  });
  it('src không dùng lớp duration giá trị tuỳ ý trong ngoặc vuông (mơ hồ với tailwindcss-animate)', () => {
    const bad = walk(join(__dirname, '..'))
      .filter((f) => !f.endsWith('motionTokens.test.ts'))
      .filter((f) => /duration-\[\d+ms\]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
