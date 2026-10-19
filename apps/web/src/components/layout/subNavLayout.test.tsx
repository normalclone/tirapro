import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Route, Routes } from 'react-router-dom';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { SubNavLayout } from './SubNavLayout';
import { RAIL_SURFACE, RAIL_WIDTH } from './railSurface';
import type { SubNavGroup } from './subNavModel';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

const groups: SubNavGroup[] = [
  { label: 'Chung', items: [{ to: '/settings/general', label: 'Chung nè' }] },
  { label: 'Ẩn hết', items: [{ to: '/settings/x', label: 'X', hidden: true }] },
  { label: 'Cách làm việc', items: [{ to: '/settings/roles', label: 'Vai trò' }] },
];

// SSR không có `window.matchMedia` → useMediaQuery trả fallback false = khung hình mobile (dưới lg).
const render = (location: string) =>
  renderToStaticMarkup(
    <StaticRouter location={location}>
      <Routes>
        <Route
          path="settings"
          element={
            <SubNavLayout
              title="Cài đặt"
              ariaLabel="Mục cài đặt"
              groups={groups}
              basePath="/settings"
              top={<a href="/p/x/board">Về dự án X</a>}
            />
          }
        >
          <Route index element={<p>INDEX-REDIRECT</p>} />
          <Route path="roles" element={<h1>Vai trò</h1>} />
        </Route>
      </Routes>
    </StaticRouter>,
  );

describe('SubNavLayout — mobile ở basePath: danh sách mục', () => {
  const out = render('/settings');
  it('có đúng một h1 = tên khu vực, nhóm là h2 sentence-case, nhóm rỗng bị bỏ', () => {
    expect(out.match(/<h1\b/g)).toHaveLength(1);
    expect(out).toContain('>Cài đặt</h1>');
    expect(out).toContain('>Chung</h2>');
    expect(out).toContain('>Cách làm việc</h2>');
    expect(out).not.toContain('Ẩn hết');
  });
  it('mỗi mục là link tới route con kèm chevron ẩn khỏi trình đọc màn hình', () => {
    expect(out).toMatch(/<a [^>]*href="\/settings\/roles"/);
    expect(out).toMatch(/<a [^>]*href="\/settings\/general"/);
    expect(out).toContain('lucide-chevron-right');
  });
  it('không render Outlet (redirect index không chạy ở mobile) và không có link quay lại', () => {
    expect(out).not.toContain('INDEX-REDIRECT');
    expect(out).not.toContain('Quay lại');
  });
  it('slot top hiện trong danh sách', () => {
    expect(out).toContain('Về dự án X');
  });
});

describe('SubNavLayout — mobile ở trang con, có slot top', () => {
  it('slot top nằm trong hàng quay lại, trước nội dung trang con (không chỉ ở rail/danh sách)', () => {
    const out = render('/settings/roles');
    const row = out.indexOf('lg:hidden');
    expect(out.indexOf('Về dự án X', row)).toBeGreaterThan(row);
    expect(out.indexOf('Về dự án X', row)).toBeLessThan(out.indexOf('<h1>Vai trò</h1>'));
  });
  it('hàng quay lại cùng bề rộng khung (max-w theo frameSize), giữ ?query ở link về danh sách', () => {
    const out = render('/settings/roles?project=p1');
    expect(out).toMatch(
      /<div class="mx-auto [^"]*max-w-3xl[^"]*lg:hidden|<div class="mx-auto [^"]*lg:hidden[^"]*max-w-3xl/,
    );
    expect(out).toMatch(/<a [^>]*aria-label="Quay lại Cài đặt"[^>]*href="\/settings\?project=p1"/);
  });
});

describe('SubNavLayout — mobile ở trang con', () => {
  const out = render('/settings/roles');
  it('có "‹ Cài đặt" (aria-label "Quay lại Cài đặt") về basePath, chỉ dưới lg', () => {
    expect(out).toMatch(
      /<a [^>]*aria-label="Quay lại Cài đặt"[^>]*lg:hidden[^>]*href="\/settings"/,
    );
  });
  it('render nội dung trang con, không render danh sách', () => {
    expect(out).toContain('<h1>Vai trò</h1>');
    expect(out.match(/<h1\b/g)).toHaveLength(1);
    expect(out).not.toContain('<h2');
  });
});

describe('SubNavLayout — rail desktop', () => {
  const out = render('/settings/roles');
  it('rail chỉ hiện từ lg, rộng 240px, có aria-label', () => {
    const cls = (out.match(/<nav aria-label="Mục cài đặt" class="([^"]*)"/)?.[1] ?? '').split(' ');
    for (const t of [...RAIL_SURFACE.split(' '), RAIL_WIDTH.nav, 'hidden', 'lg:flex'])
      expect(cls).toContain(t);
    expect(RAIL_WIDTH.nav).toBe('lg:w-60');
  });
  it('tên khu vực là chữ phụ <p>, không phải heading; nhóm không uppercase', () => {
    expect(out).toMatch(/<p class="[^"]*">Cài đặt<\/p>/);
    expect(out).toMatch(/<p class="[^"]*text-muted[^"]*">Chung<\/p>/);
    expect(src('components/layout/SubNavLayout.tsx')).not.toMatch(/uppercase/);
  });
  it('index chỉ bị thay bằng danh sách khi KHÔNG phải desktop (desktop vẫn chạy route index)', () => {
    expect(src('components/layout/SubNavLayout.tsx')).toMatch(
      /showList\s*=\s*!isDesktop\s*&&\s*isIndexPath\(/,
    );
    expect(src('components/layout/SubNavLayout.tsx')).toMatch(/useMediaQuery\(DESKTOP_MIN_QUERY\)/);
  });
});

describe('ba layout mỏng', () => {
  it('Settings/Manage/Connect dùng SubNavLayout, không còn h1 hay dải chip tự vẽ', () => {
    for (const f of [
      'features/settings/SettingsLayout.tsx',
      'features/manage/ManageLayout.tsx',
      'features/connect/ConnectLayout.tsx',
    ]) {
      const s = src(f);
      expect(s, f).toMatch(/<SubNavLayout/);
      expect(s, f).not.toMatch(/<h1|uppercase|scroll-fade-x|<Outlet/);
    }
  });
  it('basePath khớp khu vực', () => {
    expect(src('features/settings/SettingsLayout.tsx')).toMatch(/basePath="\/settings"/);
    expect(src('features/manage/ManageLayout.tsx')).toMatch(/basePath="\/manage"/);
    expect(src('features/connect/ConnectLayout.tsx')).toMatch(/basePath="\/connect"/);
  });
  it('mobile-audit đo trang gốc /settings, /manage, /connect (danh sách mục)', () => {
    const audit = readFileSync(
      join(__dirname, '..', '..', '..', 'scripts', 'mobile-audit.mjs'),
      'utf8',
    );
    const routes = audit.slice(
      audit.indexOf('const DEFAULT_ROUTES'),
      audit.indexOf('const routeArg'),
    );
    for (const r of ["'/settings'", "'/manage'", "'/connect'"]) expect(routes).toContain(r);
  });
  it('Cài đặt lọc quyền TRƯỚC khi truyền groups', () => {
    const s = src('features/settings/SettingsLayout.tsx');
    expect(s.indexOf('can(i.permission)')).toBeGreaterThan(-1);
    expect(s.indexOf('can(i.permission)')).toBeLessThan(s.indexOf('<SubNavLayout'));
  });
});
