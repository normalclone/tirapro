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

/** Văn bản trong cặp ngoặc của lời gọi bắt đầu tại `open` (vị trí dấu `(`), cân bằng ngoặc. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/**
 * Có chọn HÀM `can` từ auth store không? (hàm ổn định → component không render lại khi quyền đổi.)
 * Bắt: `(s) => s.can`, `(s: AuthState) => s.can`, thân khối `{ return s.can; }`, dấu phẩy cuối, `s['can']`,
 * destructuring trong tham số `({ can }) => can`.
 * (Không bắt `const { can } = useAuth()` không selector: đăng ký MỌI thay đổi của store nên vẫn render lại khi quyền đổi.)
 * Cho phép gọi ngay (`s.can('x')`, `s['can']('x')`) vì kết quả là boolean.
 */
export function selectsCanFunction(src: string): boolean {
  for (const m of src.matchAll(/\buseAuth\s*\(/g)) {
    const args = callArgs(src, m.index + m[0].length - 1);
    if (/\.\s*can\b(?!\s*\()/.test(args)) return true; // s.can  /  s . can
    if (/\[\s*['"]can['"]\s*\](?!\s*\()/.test(args)) return true; // s['can']
    if (/\(\s*\{[^}]*\bcan\b[^}]*\}/.test(args)) return true; // ({ can }) => can
  }
  return false;
}

describe('selectsCanFunction — mẫu dò (fixture)', () => {
  const bad = [
    'const can = useAuth((s) => s.can);',
    'const can = useAuth((state) => state.can);',
    'const can = useAuth((s: AuthState) => s.can);',
    'const can = useAuth((s) => { return s.can; });',
    'const can = useAuth(\n  (s) => s.can,\n);',
    "const can = useAuth((s) => s['can']);",
    'const can = useAuth(({ can }) => can);',
    'const can = useAuth(function (s) { return s.can; });',
    'const can = useAuth((s) => s . can);',
  ];
  const good = [
    "const ok = useAuth((s) => s.can('member:manage'));",
    "const ok = useAuth((s) => s['can']('member:manage'));",
    "const ok = useAuth((s) => s.can('a') || s.can('b'));",
    'const u = useAuth((s) => s.user);',
    'const { can } = useAuth();', // đăng ký toàn store → vẫn phản ứng, không phải lỗi
    'const p = useAuth((s) => s.permissions);',
    "const x = useAuth.getState().can('a');",
    'const canManage = useAuth((s) => s.user?.canManage);',
  ];
  it.each(bad)('bắt: %s', (code) => expect(selectsCanFunction(code)).toBe(true));
  it.each(good)('cho qua: %s', (code) => expect(selectsCanFunction(code)).toBe(false));
});

describe('không chọn hàm `can` từ auth store (P-C12)', () => {
  it('không file nguồn nào chọn hàm can', () => {
    const bad = walk(ROOT)
      .filter((f) => selectsCanFunction(readFileSync(f, 'utf8')))
      .map((f) => f.replace(ROOT, 'src'));
    expect(bad).toEqual([]);
  });
});

describe('toastReplace mặc định thời lượng', () => {
  it('reset duration về undefined để rơi về mặc định của Toaster', () => {
    expect(readFileSync(join(ROOT, 'lib/toastReplace.ts'), 'utf8')).toMatch(/duration: undefined/);
  });
});
