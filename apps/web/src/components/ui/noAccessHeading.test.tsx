import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { NotFoundPage } from '@/components/layout/NotFoundPage';
import { NoAccess } from './NoAccess';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const at = (path: string, el: React.ReactElement) =>
  renderToStaticMarkup(<StaticRouter location={path}>{el}</StaticRouter>);
const count = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;

describe('một h1 khi trang "không có quyền / không tìm thấy" nằm dưới h1 của dự án', () => {
  it('NoAccess: mặc định h1; headingLevel=2 → h2 (không h1)', () => {
    const top = at('/admin', <NoAccess />);
    expect(count(top, 'h1')).toBe(1);
    const inProject = at('/p/DEMO/triage', <NoAccess headingLevel={2} />);
    expect(count(inProject, 'h1')).toBe(0);
    expect(count(inProject, 'h2')).toBe(1);
  });
  it('NotFoundPage: trong dự án → h2 (h1 là tên dự án ở ProjectLayout); ngoài dự án → h1', () => {
    const inProject = at('/p/DEMO/khong-co', <NotFoundPage />);
    expect(count(inProject, 'h1')).toBe(0);
    expect(count(inProject, 'h2')).toBe(1);
    const outside = at('/khong-co', <NotFoundPage />);
    expect(count(outside, 'h1')).toBe(1);
    expect(count(outside, 'h2')).toBe(0);
  });
  it('Việc mới vào (tab trong dự án) truyền headingLevel={2} khi không có quyền', () => {
    expect(read('features/triage/TriagePage.tsx')).toMatch(/<NoAccess[^>]*headingLevel=\{2\}/);
  });
  it('NotFoundPage chọn cấp theo projectKey', () => {
    expect(read('components/layout/NotFoundPage.tsx')).toMatch(
      /headingLevel=\{projectKey \? 2 : 1\}/,
    );
  });
  it('không còn NoAccess/StatusPanel nào dưới ProjectLayout mà dùng h1 mặc định', () => {
    // Các nơi dựng NoAccess/StatusPanel NGOÀI dự án (Admin, Bảng tổng quan, RequireAccess, RouteError) giữ h1; trong
    // dự án (tab, 404 của dự án, xem nhanh/Không tìm thấy công việc) phải hạ cấp.
    for (const f of [
      'features/triage/TriagePage.tsx',
      'features/issues/IssueNotFound.tsx',
      'features/issues/peek/IssuePeekPanel.tsx',
    ])
      expect(read(f), f).toMatch(/headingLevel=\{2\}/);
  });
});
