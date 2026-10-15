import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimeProgressBar } from './TimeProgressBar';

const html = (canEstimate: boolean, original: number | null, spent = 3600) =>
  renderToStaticMarkup(
    createElement(TimeProgressBar, { spent, original, remaining: null, canEstimate }),
  );

describe('TimeProgressBar — chưa có ước lượng gốc', () => {
  it('có quyền ước lượng: câu mời đặt ước lượng, KHÔNG có nút riêng (nút nằm ở dòng dưới panel)', () => {
    const h = html(true, null);
    expect(h).toContain('Chưa có ước lượng gốc — đặt ước lượng để xem tiến độ.');
    expect(h).not.toContain('<button');
    expect(h).not.toContain('aria-valuenow');
    expect(h).toContain('aria-valuetext="Chưa có ước lượng gốc"');
  });
  it('không có quyền: chỉ câu trạng thái trung tính, không kêu gọi hành động', () => {
    const h = html(false, null);
    expect(h).toContain('Chưa có ước lượng gốc.');
    expect(h).not.toContain('đặt ước lượng');
    expect(h).not.toContain('<button');
  });
  it('đã có ước lượng: không hiện câu gợi ý, có aria-valuenow', () => {
    const h = html(true, 7200);
    expect(h).not.toContain('Chưa có ước lượng gốc —');
    expect(h).toContain('aria-valuenow="50"');
  });
});
