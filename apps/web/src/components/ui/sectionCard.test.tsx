import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionCard, sectionHeadingTag } from './SectionCard';

describe('sectionHeadingTag', () => {
  it('mặc định h2, level 3 → h3', () => {
    expect(sectionHeadingTag()).toBe('h2');
    expect(sectionHeadingTag(2)).toBe('h2');
    expect(sectionHeadingTag(3)).toBe('h3');
  });
});

describe('SectionCard — markup', () => {
  it('tối thiểu: khung viền + h2 + thân p-5, không footer/actions/icon', () => {
    const out = renderToStaticMarkup(<SectionCard title="Chung">nội dung</SectionCard>);
    expect(out).toContain('<section class="rounded-lg border border-border bg-surface"');
    expect(out).toContain('<h2 class="text-base font-semibold text-ink-strong">Chung</h2>');
    expect(out).toContain('<div class="p-5">nội dung</div>');
    expect(out).not.toContain('border-t');
    expect(out).not.toContain('h-8 w-8');
  });
  it('forward id và data-tour lên <section>', () => {
    const out = renderToStaticMarkup(
      <SectionCard title="T" id="add-member" data-tour="members-add">
        x
      </SectionCard>,
    );
    expect(out).toMatch(/<section [^>]*id="add-member"/);
    expect(out).toMatch(/<section [^>]*data-tour="members-add"/);
  });
  it('icon: primary mặc định, neutral cho logo màu', () => {
    const primary = renderToStaticMarkup(
      <SectionCard title="T" icon={<i />}>
        x
      </SectionCard>,
    );
    expect(primary).toContain('bg-primary-subtle text-primary');
    const neutral = renderToStaticMarkup(
      <SectionCard title="T" icon={<i />} iconTone="neutral">
        x
      </SectionCard>,
    );
    expect(neutral).toContain('bg-surface-2');
    expect(neutral).not.toContain('text-primary');
  });
  it('actions nằm trong header, footer là thanh đáy căn phải có đường kẻ trên', () => {
    const out = renderToStaticMarkup(
      <SectionCard
        title="T"
        description="mô tả"
        actions={<button type="button">Thêm</button>}
        footer={<button type="button">Lưu</button>}
      >
        x
      </SectionCard>,
    );
    const headerEnd = out.indexOf('<div class="p-5">');
    expect(out.indexOf('Thêm')).toBeGreaterThan(-1);
    expect(out.indexOf('Thêm')).toBeLessThan(headerEnd);
    expect(out.indexOf('Lưu')).toBeGreaterThan(headerEnd);
    expect(out).toMatch(/justify-end[^"]*border-t|border-t[^"]*justify-end/);
    expect(out).toContain('mô tả');
  });
  it('bare bỏ đệm thân; headingLevel=3 → h3; className nối thêm', () => {
    const out = renderToStaticMarkup(
      <SectionCard title="T" bare headingLevel={3} className="mt-4">
        x
      </SectionCard>,
    );
    expect(out).not.toContain('p-5"');
    expect(out).toContain('<h3');
    expect(out).toContain('mt-4');
  });
  it('không title/mô tả/icon/actions → không có header, thân vẫn đệm p-5', () => {
    const out = renderToStaticMarkup(<SectionCard>nội dung</SectionCard>);
    expect(out).not.toMatch(/\bborder-b\b/);
    expect(out).not.toMatch(/<h[23]/);
    expect(out).toContain('<div class="p-5">nội dung</div>');
  });
});
