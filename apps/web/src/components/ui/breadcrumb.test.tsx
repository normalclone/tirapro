import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { Breadcrumb, breadcrumbItems } from './Breadcrumb';

describe('breadcrumbItems', () => {
  it('cấp cuối là trang hiện tại, kể cả khi có to', () => {
    expect(
      breadcrumbItems([
        { label: 'A', to: '/a' },
        { label: 'B', to: '/b' },
      ]),
    ).toEqual([
      { kind: 'link', label: 'A', to: '/a' },
      { kind: 'current', label: 'B' },
    ]);
  });
  it('cấp giữa: to → link, onClick → button, không có gì → text', () => {
    const onClick = () => {};
    expect(
      breadcrumbItems([
        { label: 'A', to: '/a' },
        { label: 'B', onClick },
        { label: 'C' },
        { label: 'D' },
      ]),
    ).toEqual([
      { kind: 'link', label: 'A', to: '/a' },
      { kind: 'button', label: 'B', onClick },
      { kind: 'text', label: 'C' },
      { kind: 'current', label: 'D' },
    ]);
  });
  it('to thắng onClick khi có cả hai', () => {
    const [a] = breadcrumbItems([{ label: 'A', to: '/a', onClick: () => {} }, { label: 'B' }]);
    expect(a?.kind).toBe('link');
  });
  it('bỏ cấp rỗng (tên chưa tải/lỗi) để không có hai dấu phân cách liền nhau', () => {
    expect(
      breadcrumbItems([{ label: 'Dự án', to: '/projects' }, { label: '  ' }, { label: 'WM-1' }]),
    ).toEqual([
      { kind: 'link', label: 'Dự án', to: '/projects' },
      { kind: 'current', label: 'WM-1' },
    ]);
  });
  it('cắt khoảng trắng đầu/cuối; danh sách rỗng → []', () => {
    expect(breadcrumbItems([{ label: ' A ' }])).toEqual([{ kind: 'current', label: 'A' }]);
    expect(breadcrumbItems([])).toEqual([]);
  });
});

describe('Breadcrumb — markup', () => {
  const html = (items: Parameters<typeof Breadcrumb>[0]['items']) =>
    renderToStaticMarkup(
      <StaticRouter location="/">
        <Breadcrumb items={items} />
      </StaticRouter>,
    );

  it('nav "Đường dẫn" > ol, cấp cuối aria-current="page" không phải link', () => {
    const out = html([
      { label: 'Cài đặt', to: '/settings' },
      { label: 'Thông báo', to: '/x' },
    ]);
    expect(out).toContain('<nav aria-label="Đường dẫn"');
    expect(out).toContain('<ol');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/<a [^>]*href="\/settings"/);
    expect(out).not.toContain('href="/x"');
  });
  it('dấu chevron ẩn khỏi trình đọc màn hình, đúng n-1 dấu', () => {
    const out = html([{ label: 'A', to: '/a' }, { label: 'B', to: '/b' }, { label: 'C' }]);
    expect(out.match(/<li aria-hidden="true"/g)).toHaveLength(2);
  });
  it('cấp nút (Wiki) render <button type="button">', () => {
    expect(html([{ label: 'Gốc', onClick: () => {} }, { label: 'Trang' }])).toContain(
      '<button type="button"',
    );
  });
  it('không có cấp nào → không render gì', () => {
    expect(html([])).toBe('');
  });
});
