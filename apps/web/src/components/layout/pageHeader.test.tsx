import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { PageFrame } from './PageFrame';
import { PageHeader, pageHeaderTag, type PageHeaderProps } from './PageHeader';

const render = (props: PageHeaderProps) =>
  renderToStaticMarkup(
    <StaticRouter location="/">
      <PageFrame size="sm" data-tour="frame">
        <PageHeader {...props} />
      </PageFrame>
    </StaticRouter>,
  );

describe('pageHeaderTag', () => {
  it('page → h1, tab → h2', () => {
    expect(pageHeaderTag()).toBe('h1');
    expect(pageHeaderTag('page')).toBe('h1');
    expect(pageHeaderTag('tab')).toBe('h2');
  });
});

describe('PageHeader — trang thử', () => {
  const full: PageHeaderProps = {
    title: 'Thông báo',
    description: 'Chọn việc nào đáng báo cho bạn.',
    breadcrumb: [{ label: 'Cài đặt', to: '/settings' }, { label: 'Thông báo' }],
    actions: <button type="button">Lưu</button>,
    back: { label: 'Cài đặt', to: '/settings' },
    titleId: 'page-title',
    'data-tour': 'settings-notifications',
  };

  it('một h1 có id cho aria-labelledby, không có h2', () => {
    const out = render(full);
    expect(out.match(/<h1\b/g)).toHaveLength(1);
    expect(out).toContain('<h1 id="page-title"');
    expect(out).not.toContain('<h2');
  });
  it('variant="tab" → h2, không h1', () => {
    const out = render({ ...full, variant: 'tab' });
    expect(out).toContain('<h2');
    expect(out).not.toContain('<h1');
  });
  it('forward data-tour lên <header>', () => {
    expect(render(full)).toContain('<header class="mb-6" data-tour="settings-notifications"');
    expect(render({ title: 'x' })).not.toContain('data-tour="settings');
  });
  it('PageFrame forward data-tour', () => {
    expect(render(full)).toContain('data-tour="frame"');
  });
  it('mô tả và actions hiện đúng chỗ', () => {
    const out = render(full);
    expect(out).toContain('Chọn việc nào đáng báo cho bạn.');
    expect(out).toContain('<button type="button">Lưu</button>');
  });
  it('back: link "Quay lại …" chỉ hiện dưới lg', () => {
    const out = render(full);
    expect(out).toMatch(
      /<a [^>]*aria-label="Quay lại Cài đặt"[^>]*lg:hidden[^>]*href="\/settings"/,
    );
  });
  it('breadcrumb hiện ở mọi cỡ mặc định, kể cả khi có back (không còn phụ thuộc back)', () => {
    const out = render(full);
    expect(out).toContain('<nav aria-label="Đường dẫn"');
    expect(out).not.toContain('max-lg:hidden');
  });
  it('breadcrumbMobile={false} → breadcrumb ẩn dưới lg (trang trong SubNavLayout)', () => {
    const out = render({ ...full, back: undefined, breadcrumbMobile: false });
    expect(out).toMatch(/<nav aria-label="Đường dẫn" class="[^"]*max-lg:hidden/);
  });
  it('không có back → không có link quay lại', () => {
    expect(render({ ...full, back: undefined })).not.toContain('Quay lại');
  });
  it('breadcrumb rỗng hoặc toàn cấp trống → không render nav', () => {
    expect(render({ title: 'x', breadcrumb: [] })).not.toContain('<nav');
    expect(render({ title: 'x', breadcrumb: [{ label: ' ' }] })).not.toContain('<nav');
  });
  it('tối thiểu chỉ cần title', () => {
    const out = render({ title: 'Dự án' });
    expect(out).toContain('>Dự án</h1>');
    expect(out).not.toContain('<nav');
    expect(out).not.toContain('<p ');
  });
});
