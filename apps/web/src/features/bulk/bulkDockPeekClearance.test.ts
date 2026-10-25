import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../..');
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * I2 (rà soát toàn nhánh): ở 768–1023px ngăn xem nhanh là `fixed right-0 z-sticky` rộng tới 30rem, cùng tầng với dock
 * → ngăn thắng và che Điểm / Ưu tiên / Nhãn. Dock phải chừa đúng bề rộng ngăn khi ngăn đang mở dưới `lg`.
 */
describe('BulkDock chừa chỗ cho ngăn xem nhanh dưới lg', () => {
  const dock = src('features/bulk/BulkDock.tsx');
  const peek = src('features/issues/peek/IssuePeekPanel.tsx');

  it('cả hai kiểu đặt (sticky, docked) dùng chung lớp chừa ngăn, chỉ áp dưới lg khi có aside[data-peek-panel]', () => {
    const m = /const PEEK_CLEAR_CLS =\s*'([^']+)'/.exec(dock);
    expect(m).not.toBeNull();
    const cls = m![1];
    expect(cls).toContain('max-lg:');
    expect(cls).toContain('aside[data-peek-panel]');
    expect(cls).toMatch(/min\(30rem,100vw\)/);
    expect(dock).toMatch(/placement === 'sticky'\s*\?\s*STICKY_CLS\s*:\s*DOCKED_CLS/);
    expect(dock).toMatch(/\n\s*PEEK_CLEAR_CLS,/);
  });

  it('bề rộng chừa khớp ngăn: ngăn dưới lg rộng tối đa 30rem và vẫn là aside[data-peek-panel]', () => {
    expect(peek).toContain('<aside');
    expect(peek).toContain('data-peek-panel');
    expect(peek).toContain('max-w-[30rem]');
    expect(peek).toContain('lg:static');
  });
});
