import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** M-a11y1: nút chuyển trạng thái trên trang chi tiết — số phím tắt không được vào tên truy cập ("Trả lại1"). */
describe('nút chuyển trạng thái ở trang chi tiết: phím tắt ngoài tên truy cập', () => {
  const s = readFileSync(join(__dirname, 'IssueDetailPage.tsx'), 'utf8');
  it('<kbd> số là aria-hidden và phím tắt đi qua aria-keyshortcuts trên nút (chỉ khi có phím)', () => {
    expect(s).toMatch(/<kbd\s+aria-hidden\b/);
    expect(s).toMatch(/aria-keyshortcuts=\{i < 9 \? String\(i \+ 1\) : undefined\}/);
  });
});
