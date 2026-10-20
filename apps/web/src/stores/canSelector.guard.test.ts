import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** `useAuth((s) => s.can)` chọn HÀM ổn định → component không render lại khi quyền đổi. */
const FN_SELECTOR = /useAuth\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.can\s*\)/;

describe('không chọn hàm `can` từ auth store (P-C12)', () => {
  it('không file nguồn nào dùng useAuth((s) => s.can)', () => {
    const bad = walk(ROOT)
      .filter((f) => FN_SELECTOR.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(ROOT, 'src'));
    expect(bad).toEqual([]);
  });
});

describe('toastReplace mặc định thời lượng', () => {
  it('reset duration về undefined để rơi về mặc định của Toaster', () => {
    expect(readFileSync(join(ROOT, 'lib/toastReplace.ts'), 'utf8')).toMatch(/duration: undefined/);
  });
});
