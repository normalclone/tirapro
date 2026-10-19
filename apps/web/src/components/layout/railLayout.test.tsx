import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RailLayout } from './RailLayout';

describe('RailLayout — master–detail có rail trái', () => {
  const out = renderToStaticMarkup(
    <RailLayout ariaLabel="Bộ lọc đã lưu" rail={<span>RAIL</span>} railClassName="gap-0">
      <h1>NỘI DUNG</h1>
    </RailLayout>,
  );
  it('rail là aside có tên, rộng 288px từ lg, nền surface + viền phải, không card viền 4 phía', () => {
    expect(out).toMatch(/<aside aria-label="Bộ lọc đã lưu" class="[^"]*lg:w-72[^"]*lg:border-r/);
    expect(out).toMatch(/bg-surface/);
    expect(out).not.toMatch(/rounded-lg/);
  });
  it('rail không có heading; h1 nằm ở nội dung; nội dung cuộn riêng', () => {
    expect(out.indexOf('RAIL')).toBeLessThan(out.indexOf('NỘI DUNG'));
    expect(out.match(/<h[1-6]/g)).toHaveLength(1);
    expect(out).toContain('min-w-0 flex-1 overflow-auto');
  });
  it('railClassName ghi đè được (Wiki bỏ đệm vì cây trang tự đệm)', () => {
    expect(out).toContain('gap-0');
  });
});
