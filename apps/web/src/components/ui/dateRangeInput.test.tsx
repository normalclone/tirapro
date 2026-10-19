import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DateRangeInput } from './DateRangeInput';

const NOW = new Date(2026, 9, 20, 9);
const render = (props: Partial<Parameters<typeof DateRangeInput>[0]> = {}) =>
  renderToStaticMarkup(
    <DateRangeInput
      groupLabel="Thời gian sprint"
      start="2026-10-20"
      end="2026-11-02"
      onStartChange={() => undefined}
      onEndChange={() => undefined}
      startId="r-start"
      endId="r-end"
      now={NOW}
      {...props}
    />,
  );
const tag = (html: string, id: string) => new RegExp(`<input[^>]* id="${id}"[^>]*>`).exec(html)![0];
const attr = (t: string, n: string) => new RegExp(` ${n}="([^"]*)"`).exec(t)?.[1];
const status = (h: string) => /<p[^>]*id="([^"]+)"[^>]*role="status"[^>]*>([^<]*)<\/p>/.exec(h);

describe('<DateRangeInput>', () => {
  it('nhóm có tên theo trường của form; mỗi ô có nhãn nhìn thấy (label for)', () => {
    const h = render();
    expect(h).toMatch(/role="group"[^>]*aria-label="Thời gian sprint"/);
    expect(h).toMatch(/<label[^>]*for="r-start"[^>]*>Bắt đầu<\/label>/);
    expect(h).toMatch(/<label[^>]*for="r-end"[^>]*>Kết thúc<\/label>/);
  });
  it('nhãn tuỳ biến', () => {
    const h = render({ startLabel: 'Từ ngày', endLabel: 'Đến ngày' });
    expect(h).toMatch(/for="r-start"[^>]*>Từ ngày</);
    expect(h).toMatch(/for="r-end"[^>]*>Đến ngày</);
  });
  it('tóm tắt đúng chữ của brief, role=status, cả hai ô trỏ aria-describedby tới nó (không nằm trong tên)', () => {
    const h = render();
    const m = status(h);
    expect(m?.[2]).toBe('14 ngày · 20/10 – 02/11');
    expect(attr(tag(h, 'r-start'), 'aria-describedby')).toContain(m![1]!);
    expect(attr(tag(h, 'r-end'), 'aria-describedby')).toContain(m![1]!);
    expect(attr(tag(h, 'r-start'), 'aria-label')).toBeUndefined();
  });
  it('thiếu một đầu: vùng tóm tắt vẫn có (giữ chỗ) nhưng rỗng, ô không trỏ tới nó', () => {
    const h = render({ end: '' });
    expect(status(h)?.[2]).toBe('');
    expect(attr(tag(h, 'r-end'), 'aria-describedby')).toBeUndefined();
  });
  it('kết thúc < bắt đầu: lỗi hiện ở ô KẾT THÚC (aria-invalid + describedby + dòng lỗi), ô bắt đầu không bị đánh dấu, không có tóm tắt', () => {
    const h = render({ start: '2026-10-20', end: '2026-10-10' });
    const end = tag(h, 'r-end');
    expect(attr(end, 'aria-invalid')).toBe('true');
    expect(h).toContain('Ngày kết thúc không được trước ngày bắt đầu');
    const errId = /<p id="([^"]+)" role="alert"[^>]*>Ngày kết thúc không được trước/.exec(h)![1]!;
    expect(attr(end, 'aria-describedby')).toContain(errId);
    expect(attr(tag(h, 'r-start'), 'aria-invalid')).toBeUndefined();
    expect(status(h)?.[2]).toBe('');
  });
  it('câu lỗi riêng của nơi dùng', () => {
    const h = render({ end: '2026-10-10', errorMessage: 'Ngày mục tiêu sớm hơn ngày bắt đầu' });
    expect(h).toContain('Ngày mục tiêu sớm hơn ngày bắt đầu');
  });
  it('cùng ngày không phải lỗi', () => {
    const h = render({ end: '2026-10-20' });
    expect(h).not.toContain('role="alert"');
    expect(status(h)?.[2]).toBe('1 ngày · 20/10');
  });
  it('trống cả hai: không lỗi, không tóm tắt, không thêm required', () => {
    const h = render({ start: '', end: '' });
    expect(h).not.toContain('role="alert"');
    expect(tag(h, 'r-start')).not.toMatch(/\srequired=/);
    expect(tag(h, 'r-end')).not.toMatch(/\srequired=/);
  });
  it('startRequired / startDisabled chuyển xuống ô bắt đầu', () => {
    const h = render({ startRequired: true, startDisabled: true });
    expect(tag(h, 'r-start')).toMatch(/\srequired=/);
    expect(tag(h, 'r-start')).toMatch(/\sdisabled=/);
    expect(tag(h, 'r-end')).not.toMatch(/\sdisabled=/);
  });
  it('gợi ý nằm ở aria-describedby, không nằm trong nhãn', () => {
    const h = render({ endHint: '(tùy chọn)' });
    expect(h).toMatch(/for="r-end"[^>]*>Kết thúc<\/label>/);
    expect(attr(tag(h, 'r-end'), 'aria-describedby')).toContain('r-end-hint');
    expect(h).toContain('id="r-end-hint"');
  });
  it('mobile: xếp dọc dưới sm, hai cột từ sm (không tràn ngang)', () => {
    expect(render()).toMatch(/grid-cols-1[^"]*sm:grid-cols-2/);
  });
  it('ô ngày vẫn mang data-custom-validity (blockOnInvalidDate tìm được)', () => {
    const h = render();
    expect(tag(h, 'r-start')).toContain('data-custom-validity');
    expect(tag(h, 'r-end')).toContain('data-custom-validity');
  });
});

describe('DateRangeInput: dựng từ hai DateInput có sẵn, không viết lại xử lý ngày', () => {
  const src = () => readFileSync(join(__dirname, 'DateRangeInput.tsx'), 'utf8');
  it('dùng DateInput, FormField và hàm thuần ở lib/dateRange', () => {
    expect(src()).toMatch(/from '@\/components\/ui\/DateInput'/);
    expect(src()).toMatch(/from '@\/components\/ui\/FormField'/);
    expect(src()).toMatch(/from '@\/lib\/dateRange'/);
    expect(src()).not.toMatch(/type=["']date["']/);
  });
});
