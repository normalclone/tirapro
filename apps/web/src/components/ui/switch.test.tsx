import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Switch } from './Switch';

const src = () => readFileSync(join(__dirname, 'Switch.tsx'), 'utf8');
const html = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <Switch
      checked
      onChange={() => undefined}
      label="Được giao việc"
      description="Khi bạn được gán vào một công việc"
      id="sw"
      {...(extra as object)}
    />,
  );
const button = (h: string) => /<button[^>]*>/.exec(h)![0];
const attr = (tag: string, n: string) => new RegExp(` ${n}="([^"]*)"`).exec(tag)?.[1];

describe('<Switch>', () => {
  it('button role="switch" + aria-checked theo giá trị', () => {
    expect(button(html())).toMatch(/type="button"/);
    expect(attr(button(html()), 'role')).toBe('switch');
    expect(attr(button(html()), 'aria-checked')).toBe('true');
    expect(attr(button(html({ checked: false })), 'aria-checked')).toBe('false');
  });
  it('tên = CHỈ nhãn (aria-labelledby tới span nhãn), mô tả qua aria-describedby (không lặp trong tên)', () => {
    const h = html();
    const b = button(h);
    const lab = attr(b, 'aria-labelledby')!;
    const desc = attr(b, 'aria-describedby')!;
    expect(h).toMatch(new RegExp(`id="${lab}"[^>]*>Được giao việc<`));
    expect(h).toMatch(new RegExp(`id="${desc}"[^>]*>Khi bạn được gán vào một công việc<`));
    expect(desc).not.toBe(lab);
    expect(desc.split(' ')).toHaveLength(1);
  });
  it('không mô tả → không có aria-describedby', () => {
    expect(attr(button(html({ description: undefined })), 'aria-describedby')).toBeUndefined();
  });
  it('bấm nhãn cũng bật/tắt (label htmlFor trỏ tới nút)', () => {
    const h = html();
    expect(h).toMatch(/<label[^>]*for="sw"/);
    expect(attr(button(h), 'id')).toBe('sw');
  });
  it('tắt: disabled + aria-disabled; vẫn đọc được trạng thái', () => {
    const b = button(html({ disabled: true }));
    expect(b).toMatch(/ disabled=""/);
    expect(attr(b, 'aria-disabled')).toBe('true');
    expect(attr(b, 'aria-checked')).toBe('true');
  });
  it('bật/tắt khác nhau hơn màu: vị trí núm (translate) + dấu tích khi bật', () => {
    expect(html()).toContain('translate-x-4');
    expect(html({ checked: false })).not.toContain('translate-x-4');
    expect(html()).toMatch(/<svg[^>]*aria-hidden/);
    expect(html({ checked: false })).not.toMatch(/<svg/);
  });
  it('token DESIGN.md; motion-reduce; vùng chạm 44px cảm ứng; không gradient', () => {
    const s = src();
    expect(s).toContain('bg-primary');
    expect(s).toContain('bg-surface-3');
    expect(s).toMatch(/motion-reduce:transition-none/);
    expect(s).toContain('SWITCH_TOUCH_HIT');
    expect(s).toMatch(/pointer:coarse\)\]:min-h-11/);
    expect(s).not.toMatch(/gradient|backdrop-blur/);
  });
  it('Space/Enter bật tắt nhờ <button> native: không tự chặn phím', () => {
    expect(src()).not.toMatch(/onKeyDown/);
  });
});
