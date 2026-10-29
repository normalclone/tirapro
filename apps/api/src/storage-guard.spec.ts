import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD: tệp người dùng (đính kèm, ảnh, tệp import, cờ hệ thống) chỉ được đọc/ghi qua `ObjectStorage`.
 * Không module nghiệp vụ nào được dùng `fs` trực tiếp — nếu không, driver s3 sẽ âm thầm bỏ sót đường đó.
 * Ngoại lệ DUY NHẤT: `common/storage/local-storage.ts` (cài đặt đĩa cục bộ).
 */
const SRC = __dirname;
const ALLOWED = new Set([['common', 'storage', 'local-storage.ts'].join(sep)]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const isTestFile = (f: string) => /\.(spec|int-spec|testutil)\.ts$/.test(f);
const FS_IMPORT =
  /from\s+['"](?:node:)?fs(?:\/promises)?['"]|require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/;

describe('guard: không dùng fs ngoài LocalStorage', () => {
  const files = walk(SRC).filter((f) => !isTestFile(f));

  it('quét được nhiều tệp nguồn (guard không rỗng)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('chỉ local-storage.ts được import node:fs', () => {
    const offenders = files
      .map((f) => relative(SRC, f))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => FS_IMPORT.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('local-storage.ts vẫn tồn tại (ngoại lệ không trỏ vào hư vô)', () => {
    expect(files.map((f) => relative(SRC, f))).toContain(
      ['common', 'storage', 'local-storage.ts'].join(sep),
    );
  });
});
