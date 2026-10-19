import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SplitButton } from './SplitButton';

const src = () => readFileSync(join(__dirname, 'SplitButton.tsx'), 'utf8');
const items = [
  { id: 'another', label: 'Tạo & nhập tiếp', hint: 'Giữ cửa sổ', onSelect: () => undefined },
  { id: 'open', label: 'Tạo & mở', onSelect: () => undefined },
];
const html = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <SplitButton items={items} menuLabel="Tuỳ chọn tạo khác" {...(extra as object)}>
      Tạo
    </SplitButton>,
  );
const buttons = (h: string) => h.match(/<button[^>]*>[\s\S]*?<\/button>/g)!;
const attr = (tag: string, n: string) => new RegExp(` ${n}="([^"]*)"`).exec(tag)?.[1];
const open = (tag: string) => /<button[^>]*>/.exec(tag)![0];

describe('<SplitButton>', () => {
  it('hai nút riêng: nút chính (nhãn) + nút ▾ (tên truy cập, aria-haspopup=menu)', () => {
    const [main, more] = buttons(html());
    expect(buttons(html())).toHaveLength(2);
    expect(main).toContain('>Tạo<');
    expect(attr(open(more!), 'aria-label')).toBe('Tuỳ chọn tạo khác');
    expect(attr(open(more!), 'aria-haspopup')).toBe('menu');
    expect(attr(open(more!), 'aria-expanded')).toBe('false');
    expect(attr(open(main), 'aria-haspopup')).toBeUndefined();
  });
  it('nút chính là nút bình thường: type/form/onClick đi qua', () => {
    const [main] = buttons(html({ type: 'submit', form: 'f1' }));
    expect(attr(open(main), 'type')).toBe('submit');
    expect(attr(open(main), 'form')).toBe('f1');
    expect(attr(open(buttons(html())[0]), 'type')).toBe('button');
  });
  it('disabled dùng chung cho cả hai nút', () => {
    for (const b of buttons(html({ disabled: true }))) expect(open(b)).toMatch(/ disabled=""/);
    for (const b of buttons(html())) expect(open(b)).not.toMatch(/ disabled=""/);
  });
  it('loading dùng chung: cả hai aria-busy + disabled (không mở menu / bấm thêm khi đang gửi)', () => {
    const [main, more] = buttons(html({ loading: true }));
    for (const b of [main, more!]) {
      expect(open(b)).toMatch(/ disabled=""/);
      expect(attr(open(b), 'aria-busy')).toBe('true');
    }
  });
  it('menu đóng thì chưa dựng mục nào', () => {
    expect(html()).not.toContain('Tạo &amp; nhập tiếp');
  });
  it('cảm ứng: cả hai nút cao 44px; liền một khối (bo góc ghép) bằng token', () => {
    for (const b of buttons(html())) expect(open(b)).toContain('[@media(pointer:coarse)]:h-11');
    const [main, more] = buttons(html());
    expect(open(main)).toContain('rounded-r-none');
    expect(open(more!)).toContain('rounded-l-none');
  });
  it('hành động của mục chạy SAU khi menu đóng (onCloseAutoFocus), không chạy trong onSelect', () => {
    // Chạy ngay trong onSelect thì focus mà hành động vừa đặt (vd tóm tắt lỗi) bị bẫy focus của menu kéo lại → rơi về body.
    const s = src();
    const onSelect = /onSelect=\{\(\) => \{[\s\S]*?\n\s*\}\}/.exec(s)![0];
    expect(onSelect).toContain('pending.current = item');
    expect(onSelect).not.toContain('item.onSelect()');
    const close = /onCloseAutoFocus=\{[\s\S]*?\n\s*\}\}/.exec(s)![0];
    expect(close).toContain('pending.current');
    expect(close).toContain('preventDefault()');
    expect(close).toContain('.onSelect()');
  });
  it('nguồn: Radix dropdown, mục có mô tả qua aria-describedby (tên chỉ là nhãn), không tự refocus sau khi chọn', () => {
    const s = src();
    expect(s).toContain('@radix-ui/react-dropdown-menu');
    expect(s).toContain('aria-describedby');
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\bbg-(blue|indigo|purple)-/); // chỉ token
  });
});
