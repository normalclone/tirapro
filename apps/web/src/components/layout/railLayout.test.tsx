import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RailLayout } from './RailLayout';
import { RAIL_SURFACE, RAIL_WIDTH } from './railSurface';

describe('RailLayout — master–detail có rail trái', () => {
  const out = renderToStaticMarkup(
    <RailLayout ariaLabel="Bộ lọc đã lưu" rail={<span>RAIL</span>} railClassName="gap-0">
      <h1>NỘI DUNG</h1>
    </RailLayout>,
  );
  it('rail là aside có tên, rộng 288px từ lg, nền surface + viền phải, không card viền 4 phía', () => {
    const cls = (out.match(/<aside aria-label="Bộ lọc đã lưu" class="([^"]*)"/)?.[1] ?? '').split(
      ' ',
    );
    for (const t of [...RAIL_SURFACE.split(' '), RAIL_WIDTH.master]) expect(cls).toContain(t);
    expect(RAIL_WIDTH.master).toBe('lg:w-72');
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
