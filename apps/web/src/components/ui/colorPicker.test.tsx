import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LABEL_PALETTE } from '@/lib/labelPalette';
import { ColorPicker } from './ColorPicker';

type Extra = { format?: 'hex' | 'oklch'; disabled?: boolean; value?: string | null };
const render = (props: Extra = {}) =>
  renderToStaticMarkup(
    <ColorPicker value="#c52b30" onChange={() => undefined} ariaLabel="Màu nhãn" {...props} />,
  );
const radios = (h: string) => [...h.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
const attr = (t: string, n: string) => new RegExp(` ${n}="([^"]*)"`).exec(t)?.[1];

describe('<ColorPicker>', () => {
  it('radiogroup có tên; 8 swatch role=radio', () => {
    const h = render();
    expect(h).toMatch(
      /role="radiogroup"[^>]*aria-label="Màu nhãn"|aria-label="Màu nhãn"[^>]*role="radiogroup"/,
    );
    expect(radios(h)).toHaveLength(8);
  });
  it('tên truy cập = tên màu tiếng Việt, không phải hex', () => {
    const h = render();
    const names = radios(h).map((r) => attr(r, 'aria-label'));
    expect(names).toEqual(LABEL_PALETTE.map((e) => e.name));
    expect(h).not.toMatch(/aria-label="#/);
  });
  it('đúng một mục aria-checked=true (giá trị hiện tại, không phân biệt hoa/thường) và là điểm vào Tab duy nhất', () => {
    const h = render({ value: '#C52B30' });
    const rs = radios(h);
    expect(rs.filter((r) => attr(r, 'aria-checked') === 'true')).toHaveLength(1);
    expect(attr(rs[5]!, 'aria-checked')).toBe('true');
    expect(rs.filter((r) => attr(r, 'tabindex') === '0')).toHaveLength(1);
    expect(attr(rs[5]!, 'tabindex')).toBe('0');
  });
  it('trạng thái chọn không chỉ bằng màu: có dấu tick (svg aria-hidden) chỉ ở mục đang chọn', () => {
    const h = render();
    const buttons = h.split('<button').slice(1);
    const withCheck = buttons.filter((b) => /<svg[^>]*aria-hidden="true"/.test(b));
    expect(withCheck).toHaveLength(1);
    expect(withCheck[0]).toContain('aria-checked="true"');
  });
  it('chưa chọn (null/rỗng): không mục nào checked, mục đầu là điểm vào Tab', () => {
    for (const v of [null, '']) {
      const rs = radios(render({ value: v }));
      expect(rs.filter((r) => attr(r, 'aria-checked') === 'true')).toHaveLength(0);
      expect(attr(rs[0]!, 'tabindex')).toBe('0');
    }
  });
  it('màu cũ ngoài bảng màu → thêm swatch "Màu hiện tại" đang chọn; vẫn một điểm vào Tab', () => {
    const h = render({ value: '#6366f1' });
    const rs = radios(h);
    expect(rs).toHaveLength(9);
    const extra = rs[8]!;
    expect(attr(extra, 'aria-label')).toBe('Màu hiện tại');
    expect(attr(extra, 'aria-checked')).toBe('true');
    expect(rs.filter((r) => attr(r, 'aria-checked') === 'true')).toHaveLength(1);
    expect(rs.filter((r) => attr(r, 'tabindex') === '0')).toHaveLength(1);
    expect(h).toContain('background-color:#6366f1');
  });
  it('giá trị rác không làm vỡ: swatch "Màu hiện tại" dùng tông trung tính', () => {
    const h = render({ value: 'khong-phai-mau' });
    expect(radios(h)).toHaveLength(9);
    expect(h).toContain('var(--label-8)');
  });
  it('swatch dùng biến CSS theo giao diện, không nhúng hex của bảng màu', () => {
    const h = render();
    for (let n = 1; n <= 8; n++) expect(h).toContain(`var(--label-${n})`);
    for (const e of LABEL_PALETTE) expect(h).not.toContain(e.hex);
  });
  it('cảm ứng: swatch 44px (h-11 w-11) từ pointer: coarse', () => {
    const h = render();
    expect(h).toContain('[@media(pointer:coarse)]:h-11');
    expect(h).toContain('[@media(pointer:coarse)]:w-11');
  });
  it('format oklch (vai trò): so khớp theo chuỗi oklch của biến thể sáng', () => {
    const rs = radios(render({ value: 'oklch(0.54 0.19 25)', format: 'oklch' }));
    expect(rs).toHaveLength(8);
    expect(attr(rs[5]!, 'aria-checked')).toBe('true');
    const old = radios(render({ value: 'oklch(0.55 0.20 25)', format: 'oklch' }));
    expect(old).toHaveLength(9);
  });
  it('disabled: mọi swatch disabled, nhóm aria-disabled', () => {
    const h = render({ disabled: true });
    expect(h).toContain('aria-disabled="true"');
    expect(radios(h).every((r) => /\sdisabled=/.test(r))).toBe(true);
  });
});

describe('ColorPicker: quy ước radiogroup chung', () => {
  const src = readFileSync(join(__dirname, 'ColorPicker.tsx'), 'utf8');
  it('dùng lib/radioNav (mũi tên/Home/End, một điểm Tab) và không dùng input màu native', () => {
    expect(src).toMatch(/radioGroupKeyDownSkipDisabled/);
    expect(src).toMatch(/shouldEmitChange/);
    expect(src).not.toMatch(/type=["']color["']/);
  });
});
