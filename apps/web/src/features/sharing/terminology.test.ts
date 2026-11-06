import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bảng thuật ngữ (docs/UX_CONVENTIONS.md): "tổ chức" (không phải "tổ chức"), vai trò hiển thị "Quản trị".
 * Chỉ khoá phần chia sẻ + bộ lọc đã lưu — các chỗ khác còn chữ "tổ chức" nằm ngoài phạm vi.
 */
const dirs = [__dirname, join(__dirname, '..', 'saved-filters')];
const files = dirs.flatMap((d) =>
  readdirSync(d)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('terminology.test.ts'))
    .map((f) => ({ name: `${d.split('/').pop()}/${f}`, text: readFileSync(join(d, f), 'utf8') })),
);

const BANNED: Array<[RegExp, string]> = [
  [/không gian/i, 'dùng "tổ chức" (đã bỏ khái niệm organization)'],
  [/quản trị viên tổ chức/i, 'dùng tên vai trò hiển thị "Quản trị"'],
  [/chỉ thành viên dự án thấy/i, 'ghi chú dự án riêng tư phải nhắc Quản trị'],
];

describe('thuật ngữ chia sẻ / bộ lọc đã lưu', () => {
  it('đọc được các file nguồn', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const [re, hint] of BANNED) {
    it(`không còn ${re.source} (${hint})`, () => {
      const hits = files
        .filter(
          (f) => !f.name.endsWith('.test.ts') && !f.name.endsWith('.test.tsx') && re.test(f.text),
        )
        .map((f) => f.name);
      expect(hits).toEqual([]);
    });
  }
});
