import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_FRAME_WIDTH, pageFrameClass } from './PageFrame';
import { pageContainer } from './page';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const maxW = (s: string) => s.match(/max-w-[\w[\].-]+/g) ?? [];

describe('PageFrame — bảng cỡ (B-D1)', () => {
  it('đúng bốn cỡ sm|lg|xl|full', () => {
    expect(Object.keys(PAGE_FRAME_WIDTH)).toEqual(['sm', 'lg', 'xl', 'full']);
  });
  it.each([
    ['sm', 'max-w-3xl'],
    ['lg', 'max-w-5xl'],
    ['xl', 'max-w-7xl'],
  ] as const)('%s → %s', (size, cls) => {
    expect(pageFrameClass(size)).toContain(cls);
  });
  it('full không giới hạn bề rộng', () => {
    expect(maxW(pageFrameClass('full'))).toEqual([]);
  });
  it('đệm: ngang 16 → 24px, dọc 24 → 32px, đáy chừa FAB từ lg', () => {
    for (const size of ['sm', 'lg', 'xl', 'full'] as const) {
      const c = pageFrameClass(size);
      for (const t of [
        'mx-auto',
        'w-full',
        'px-4',
        'sm:px-6',
        'pt-6',
        'sm:pt-8',
        'pb-8',
        'lg:pb-28',
      ])
        expect(c.split(' ')).toContain(t);
    }
  });
  it('className của trang ghi đè đệm (vd py-6 của Tổng quan)', () => {
    const c = pageFrameClass('xl', 'py-6').split(' ');
    expect(c).toContain('py-6');
    expect(c).not.toContain('pt-6');
    expect(c).not.toContain('pb-8');
  });
});

describe('pageContainer — wrapper mỏng giữ chỗ khi migrate (RB1)', () => {
  it('sm/lg/xl giống hệt PageFrame', () => {
    for (const size of ['sm', 'lg', 'xl'] as const)
      expect(pageContainer(size, 'x')).toBe(pageFrameClass(size, 'x'));
  });
  it('md cũ giữ bề rộng 896px, không dính max-w-5xl', () => {
    const c = pageContainer('md');
    expect(c).toContain('max-w-4xl');
    expect(c).not.toContain('max-w-5xl');
  });
});

describe('không max-w ngoài bảng cỡ khung', () => {
  it('PageFrame.tsx: mọi max-w nằm trong bảng PAGE_FRAME_WIDTH', () => {
    const table = Object.values(PAGE_FRAME_WIDTH).filter(Boolean);
    for (const m of maxW(src('components/layout/PageFrame.tsx'))) expect(table).toContain(m);
  });
  it('page.ts: chỉ còn max-w-4xl của md cũ', () => {
    expect([...new Set(maxW(src('components/layout/page.ts')))]).toEqual(['max-w-4xl']);
  });
  it('PageHeader.tsx không tự đặt max-w', () => {
    expect(maxW(src('components/layout/PageHeader.tsx'))).toEqual([]);
  });
});
