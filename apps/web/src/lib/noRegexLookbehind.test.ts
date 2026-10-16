import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

// Ghép từ mảnh để chính file này không chứa mẫu cần tìm.
const LOOKBEHIND = ['(?<' + '=', '(?<' + '!'];

describe('regex tương thích Safari/iOS < 16.4', () => {
  it('không dùng lookbehind (literal lẫn chuỗi trong new RegExp) — Safari < 16.4 ném SyntaxError lúc nạp module', () => {
    // `apps/web/src` + các gói dùng chung nạp vào bundle web (shared/types): lookbehind ở đó cũng làm trắng trang.
    const roots = [
      join(__dirname, '..'),
      join(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'src'),
      join(__dirname, '..', '..', '..', '..', 'packages', 'types', 'src'),
    ];
    const bad = roots
      .flatMap((r) => walk(r))
      .filter((f) => !/no-?[Rr]egex-?[Ll]ookbehind/.test(f))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return LOOKBEHIND.some((p) => src.includes(p));
      });
    expect(bad.map((f) => f.split('/tirapro-wt/')[1] ?? f)).toEqual([]);
  });
});
