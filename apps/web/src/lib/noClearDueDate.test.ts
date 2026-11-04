import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** RAID/Cột mốc có `dueDate` riêng (không phải Hạn của việc) — được phép để trống. */
const OWN_DUE = /[\\/]features[\\/](raid|planning)[\\/]/;

describe('Hạn của việc là bắt buộc: web không bao giờ gửi dueDate = null', () => {
  const files = walk(root).filter((f) => !/\.test\.tsx?$/.test(f) && !OWN_DUE.test(f));
  it('không có mã nào gán `dueDate: null` hay `dueDate: … : null` khi ghi việc', () => {
    const bad = files.filter((f) => {
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return (
        /\bdueDate\s*:\s*null\b/.test(code) ||
        /\bdueDate\s*:[^,\n}]*\?[^,\n}]*:\s*null\b/.test(code)
      );
    });
    expect(bad.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});
