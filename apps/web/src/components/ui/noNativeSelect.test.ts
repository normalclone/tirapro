import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('không dùng <select> native', () => {
  it('mọi ô chọn đi qua SearchSelect/SegmentedControl', () => {
    const bad = walk(join(__dirname, '..', '..')).filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => /<select(\s|>|$)/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)),
    );
    expect(bad.map((f) => f.split('/src/')[1])).toEqual([]);
  });
});
