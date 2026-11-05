import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRID_COLS,
  TREE_COLUMNS_REM,
  TREE_GAP_REM,
  TREE_ROW_PAD_REM,
  TREE_TABLE_MIN_W_CLS,
} from './treeLayout';

const src = readFileSync(join(__dirname, 'TreePage.tsx'), 'utf8');

/** Danh sách bề rộng (rem) trong `sm:grid-cols-[...]`: `minmax(22rem,1fr)` lấy sàn 22rem, `Nrem` lấy N. */
function smColumnsRem(cls: string): number[] {
  const m = /sm:grid-cols-\[([^\]]+)\]/.exec(cls);
  if (!m) throw new Error('thiếu sm:grid-cols');
  return m[1]!.split('_').map((c) => {
    const x = /^minmax\(([\d.]+)rem,1fr\)$/.exec(c) ?? /^([\d.]+)rem$/.exec(c);
    if (!x) throw new Error(`cột không phải rem cố định / sàn: ${c}`);
    return Number(x[1]);
  });
}

describe('Cây việc: giữ nguyên bề rộng cột, bảng cuộn ngang (TIRA-BUG-21)', () => {
  it('không cột nào có sàn 0: không có `minmax(0,1fr)` từ sm trở lên (cột tiêu đề co về 0 làm chồng chữ)', () => {
    expect(GRID_COLS).not.toMatch(/sm:grid-cols-\[[^\]]*minmax\(0,/);
    expect(smColumnsRem(GRID_COLS)).toEqual(Object.values(TREE_COLUMNS_REM));
  });

  it('sàn bề rộng khung = tổng cột + khoảng cách + lề hàng (đổi một cột mà quên sàn → đỏ)', () => {
    const cols = smColumnsRem(GRID_COLS);
    const floor =
      cols.reduce((a, b) => a + b, 0) + (cols.length - 1) * TREE_GAP_REM + 2 * TREE_ROW_PAD_REM;
    const m = /^sm:min-w-\[([\d.]+)rem\]$/.exec(TREE_TABLE_MIN_W_CLS);
    expect(m).not.toBeNull();
    // làm tròn lên rem nguyên: sàn không được NHỎ hơn nhu cầu, và không dư quá 1rem
    const declared = Number(m![1]);
    expect(declared).toBeGreaterThanOrEqual(floor);
    expect(declared - floor).toBeLessThan(1);
  });

  it('TreePage: khung bảng mang sàn bề rộng, hàng tiêu đề và hàng dữ liệu dùng chung GRID_COLS', () => {
    expect(src).toMatch(
      /'overflow-hidden rounded-lg border border-border bg-surface',\s*TREE_TABLE_MIN_W_CLS,/,
    );
    expect(src.match(/^\s+GRID_COLS,$/gm)).toHaveLength(2); // hàng tiêu đề + TreeRow
    expect(src).not.toMatch(/const GRID_COLS/); // một nguồn duy nhất (treeLayout.ts)
  });

  it('hàng tiêu đề cột vẫn dính khi cuộn dọc (sticky top-0)', () => {
    expect(src).toMatch(/GRID_COLS,\s*'sticky top-0 z-10 border-b/);
  });
});
