import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { roleLabel } from '@tirapro/types';
import { describe, expect, it } from 'vitest';
import { ADMIN_TOGGLE_TOOLTIP } from './AdminUsersPage';

/**
 * Một vai trò "Quản trị" (gộp Quản trị tổ chức + Quản trị hệ thống): giao diện chỉ còn MỘT chữ "Quản trị"; không còn
 * "Admin hệ thống", "Admin HT", "quản trị hệ thống", "Quản trị chung", "quản trị tổ chức"/"quản trị viên tổ chức" ở chữ người dùng thấy.
 * Bỏ qua dòng chú thích (// , /*, *) và tệp test.
 */
const SRC = join(__dirname, '..', '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const BANNED =
  /Admin hệ thống|admin hệ thống|Admin HT|quản trị hệ thống|Quản trị hệ thống|Quản trị chung|quản trị chung|quản trị tổ chức|Quản trị tổ chức|quản trị viên tổ chức/;

describe('một chữ "Quản trị"', () => {
  it('vai trò Organization Admin hiển thị là "Quản trị"', () => {
    expect(roleLabel('Organization Admin')).toBe('Quản trị');
  });

  it('chú thích công tắc nói rõ bật = toàn quyền tổ chức + khu Quản trị', () => {
    expect(ADMIN_TOGGLE_TOOLTIP).toMatch(/toàn quyền/);
    expect(ADMIN_TOGGLE_TOOLTIP).toMatch(/khu Quản trị/);
  });

  it('không còn các cách gọi cũ trong chữ giao diện (ngoài chú thích)', () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          if (BANNED.test(line)) hits.push(`${f.replace(SRC, '')}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
