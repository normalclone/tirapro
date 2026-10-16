import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `@tirapro/shared` nằm trong chunk ĐẦU của web: regex lookbehind (`(?<=…)`, `(?<!…)`) làm Safari/iOS < 16.4 ném SyntaxError
 * ngay lúc nạp module (trắng trang), kể cả khi viết trong chuỗi của `new RegExp("…")` mà Vite không cảnh báo. Quét cả literal
 * lẫn chuỗi. Mẫu dựng bằng ghép chuỗi để chính file này không tự khớp.
 */
const LOOKBEHIND = new RegExp(String.raw`\(\?` + '<[=!]');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|mts|cts)$/.test(name) ? [full] : [];
  });
}

describe('packages/shared không dùng regex lookbehind', () => {
  const root = __dirname;

  it('không có (?<= hoặc (?<! trong bất kỳ tệp nguồn nào (literal hoặc chuỗi new RegExp)', () => {
    const offenders = sourceFiles(root)
      .filter((f) => !f.endsWith('no-regex-lookbehind.spec.ts')) // chính bộ quét (chứa mẫu trong chuỗi/chú thích)
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .flatMap((line, i) => (LOOKBEHIND.test(line) ? [`${relative(root, f)}:${i + 1}`] : [])),
      );
    expect(offenders, `Lookbehind làm trắng trang Safari < 16.4:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('tự kiểm: mẫu quét bắt được cả literal lẫn chuỗi, không bắt lookahead', () => {
    expect(LOOKBEHIND.test('const a = /(?<=x)y/;')).toBe(true);
    expect(LOOKBEHIND.test("new RegExp('(?<!x)y')")).toBe(true);
    expect(LOOKBEHIND.test('/(?=x)y/')).toBe(false);
    expect(LOOKBEHIND.test('/(?!x)y/')).toBe(false);
    expect(LOOKBEHIND.test('/(?<name>x)/')).toBe(false); // nhóm có tên là hợp lệ ở Safari 11.1+
  });
});
