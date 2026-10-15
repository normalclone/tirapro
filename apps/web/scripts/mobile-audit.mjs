// @ts-check
/**
 * Bộ đo mobile (390×844): chạy trình duyệt qua MỌI route chính và tự phát hiện lỗi bố cục.
 * Dùng làm baseline và nghiệm thu (U31); mỗi nhóm tự chạy cho màn của mình.
 *
 *   pnpm --filter @tirapro/web mobile:audit
 *   pnpm --filter @tirapro/web mobile:audit -- --route=/p/DEMO/board,/members
 *
 * Cần web + API + DB seed đang chạy (KHÔNG nằm trong `pnpm test`/CI). Dùng playwright-core + Chrome
 * hệ thống như `shot.mjs`. Đăng nhập một lần rồi điều hướng bằng SPA (token access chỉ nằm trong
 * bộ nhớ nên `page.goto` mới sẽ phải refresh bằng cookie).
 *
 * Cờ:
 *   --route=/a,/b   Chỉ đo các route này (mặc định: toàn bộ danh sách ROUTES)
 *   --base=URL      Gốc URL web (mặc định http://localhost:5173)
 *   --out=DIR       Thư mục ảnh + report.json (mặc định .shots/mobile)
 *   --no-login      Bỏ qua đăng nhập (route công khai)
 * Env: AUDIT_PROJECT (mặc định DEMO), AUDIT_ISSUE (mặc định DEMO-STORY-1),
 *      SHOT_EMAIL / SHOT_PASSWORD (mặc định admin@projira.dev / Password123, như shot.mjs).
 *
 * Phát hiện (heuristic, đủ bắt lỗi thật, ít nhiễu):
 *   page-h-scroll      trang cuộn ngang (scrollWidth > 391)
 *   overflow-right     phần tử trong main/header tràn mép phải, không nằm trong vùng cuộn ngang
 *   squeezed-text      chữ ≥ 8 ký tự, ≥ 4 dòng nhưng rộng < 140px
 *   covered-by-fixed   nút/link/ô nhập trong màn hình đầu bị phần tử position:fixed (rộng < 120px) che ≥ 30%
 *   text-overlap       hai phần tử lá có chữ giao nhau > 4×4px (không lồng nhau)
 *   header-offscreen   nút/link trong header dự án có right > 390 (trên màn hình)
 *   small-targets      > 6 nút/link cao < 28px (CẢNH BÁO — không làm exit code = 1)
 *
 * Allowlist `mobile-audit.allow.json`: { "<route>|<loại>": "lý do" }. Route có thể viết thô hoặc thay
 * khoá dự án / mã công việc bằng `:project` / `:issue`.
 * Exit code 1 nếu còn lỗi (trừ cảnh báo) ngoài allowlist.
 */
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return process.argv.includes(`--${name}`) ? true : fallback;
}

const W = 390;
const H = 844;
const PROJECT = process.env.AUDIT_PROJECT ?? 'DEMO';
const ISSUE = process.env.AUDIT_ISSUE ?? 'DEMO-STORY-1';
const base = String(arg('base', 'http://localhost:5173')).replace(/\/$/, '');
const outDir = resolve(String(arg('out', '.shots/mobile')));
const noLogin = arg('no-login', false) === true;
const email = process.env.SHOT_EMAIL ?? 'admin@projira.dev';
const password = process.env.SHOT_PASSWORD ?? 'Password123';
/** Loại chỉ cảnh báo, không chặn. */
const WARN_ONLY = new Set(['small-targets']);

const P = `/p/${PROJECT}`;
const DEFAULT_ROUTES = [
  '/',
  '/projects',
  ...['board', 'backlog', 'gantt', 'tree', 'reports', 'triage', 'activity', 'config'].map(
    (v) => `${P}/${v}`,
  ),
  `/issue/${ISSUE}`,
  '/filters',
  '/members',
  '/account',
  '/wiki',
  '/notifications',
  ...['portfolio', 'goals', 'risks', 'resources', 'response-time', 'clients'].map(
    (v) => `/manage/${v}`,
  ),
  '/connect/integrations',
  '/connect/automation',
  ...[
    'general',
    'notifications',
    'roles',
    'workflows',
    'priorities',
    'severities',
    'fields',
    'response-time',
    'import',
    'api',
  ].map((v) => `/settings/${v}`),
  '/admin',
  '/admin/workspaces',
  '/admin/accounts',
  '/admin/config',
  '/admin/system',
  '/documentation',
];
const routeArg = arg('route', '');
const ROUTES =
  typeof routeArg === 'string' && routeArg
    ? routeArg.split(',').map((r) => '/' + r.trim().replace(/^\/+/, ''))
    : DEFAULT_ROUTES;

const CHANNELS = ['chrome', 'msedge', undefined]; // undefined = chromium của Playwright nếu có

async function launch() {
  let lastErr;
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Không tìm thấy Chrome/Edge');
}

/** Chạy TRONG trang. Trả về danh sách lỗi `{ t, n?, sample? }`. */
function measure({ W, H, isProjectRoute }) {
  const issues = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > W + 1) issues.push({ t: 'page-h-scroll', n: doc.scrollWidth });

  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  const desc = (el) =>
    el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className
      ? '.' + el.className.split(' ').slice(0, 3).join('.')
      : '') +
    ' "' +
    (el.textContent || '').trim().slice(0, 30) +
    '"';

  // (2) tràn mép phải
  const over = [];
  for (const el of document.querySelectorAll('main *, header *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 2 && !inScroller(el)) over.push(desc(el) + ' right=' + Math.round(r.right));
  }
  if (over.length) issues.push({ t: 'overflow-right', n: over.length, sample: over.slice(0, 4) });

  // (3) chữ bị bóp thành cột hẹp
  const narrow = [];
  for (const el of document.querySelectorAll(
    'main h1, main h2, main h3, main p, main button, main a, main span, main label',
  )) {
    if (!vis(el) || el.children.length > 2) continue;
    const txt = (el.textContent || '').trim();
    if (txt.length < 8) continue;
    const r = el.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    if (r.height / lh >= 4 && r.width < 140)
      narrow.push(desc(el) + ` w=${Math.round(r.width)} lines≈${Math.round(r.height / lh)}`);
  }
  if (narrow.length)
    issues.push({ t: 'squeezed-text', n: narrow.length, sample: narrow.slice(0, 4) });

  // (4) bị phần tử fixed (FAB…) che
  const fixed = [...document.querySelectorAll('*')].filter(
    (e) =>
      getComputedStyle(e).position === 'fixed' && vis(e) && e.getBoundingClientRect().width < 120,
  );
  const covered = [];
  for (const f of fixed) {
    const fr = f.getBoundingClientRect();
    for (const el of document.querySelectorAll(
      'main button, main a, main input, main select, main [role=button]',
    )) {
      if (!vis(el) || f.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > H) continue;
      const ix = Math.max(0, Math.min(r.right, fr.right) - Math.max(r.left, fr.left));
      const iy = Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top));
      if (ix * iy > 0.3 * r.width * r.height && r.width < 300) covered.push(desc(el));
    }
  }
  if (covered.length)
    issues.push({
      t: 'covered-by-fixed',
      n: new Set(covered).size,
      sample: [...new Set(covered)].slice(0, 4),
    });

  // (5) chữ chồng nhau
  const leaves = [...document.querySelectorAll('main *')].filter(
    (e) => vis(e) && e.children.length === 0 && (e.textContent || '').trim().length > 1,
  );
  const overlaps = [];
  for (let i = 0; i < leaves.length && overlaps.length < 4; i++) {
    const a = leaves[i].getBoundingClientRect();
    if (a.top > H) continue;
    for (let j = i + 1; j < Math.min(leaves.length, i + 40); j++) {
      const b = leaves[j].getBoundingClientRect();
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 4 && iy > 4 && !leaves[i].contains(leaves[j]) && !leaves[j].contains(leaves[i])) {
        overlaps.push(desc(leaves[i]) + ' × ' + desc(leaves[j]));
        break;
      }
    }
  }
  if (overlaps.length) issues.push({ t: 'text-overlap', n: overlaps.length, sample: overlaps });

  // (7) nút/link trong header dự án phải nằm trọn trong màn hình.
  // Ưu tiên `[data-audit="project-header"]`; chưa gắn thì suy ra từ <h1> trong main (cha của h1 = thanh header).
  if (isProjectRoute) {
    const header =
      document.querySelector('[data-audit="project-header"]') ??
      document.querySelector('main h1')?.parentElement ??
      null;
    if (header) {
      const off = [];
      for (const el of header.querySelectorAll('button, a')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.right > W)
          off.push(desc(el) + ' right=' + Math.round(r.right));
      }
      if (off.length)
        issues.push({ t: 'header-offscreen', n: off.length, sample: off.slice(0, 4) });
    }
  }

  // (6) vùng chạm nhỏ (cảnh báo)
  const small = [
    ...document.querySelectorAll('main button, main a[href], main [role=button]'),
  ].filter(
    (e) =>
      vis(e) && e.getBoundingClientRect().height < 28 && e.getBoundingClientRect().bottom < 4000,
  ).length;
  if (small > 6) issues.push({ t: 'small-targets', n: small });

  return issues;
}

async function loadAllow() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(await readFile(join(here, 'mobile-audit.allow.json'), 'utf8'));
    return /** @type {Record<string,string>} */ (raw);
  } catch {
    return {};
  }
}

/** Chuẩn hoá route để khớp allowlist: thay khoá dự án / mã công việc bằng token. */
function tokenize(route) {
  return route.replace(`/p/${PROJECT}`, '/p/:project').replace(`/issue/${ISSUE}`, '/issue/:issue');
}

const allow = await loadAllow();
const isAllowed = (route, t) => `${route}|${t}` in allow || `${tokenize(route)}|${t}` in allow;

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await mkdir(outDir, { recursive: true });

/** @type {{ route: string, finalPath: string, issues: { t: string, n?: number, sample?: string[], allowed?: boolean }[], skipped?: string }[]} */
const report = [];
try {
  if (!noLogin) {
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  for (const route of ROUTES) {
    await page.evaluate((p) => {
      window.history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);

    const finalPath = new URL(page.url()).pathname;
    const slug = route.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'home';
    await page.screenshot({ path: join(outDir, `${slug}.png`), fullPage: false });

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
    if (/\b404\b/.test(bodyText) && /not found|không tìm thấy/i.test(bodyText)) {
      report.push({ route, finalPath, issues: [], skipped: 'route không tồn tại (404)' });
      console.log(`${route.padEnd(34)} → bỏ qua (404)`);
      continue;
    }
    const issues = await page.evaluate(measure, {
      W,
      H,
      isProjectRoute: /^\/p\/[^/]+\//.test(route),
    });
    for (const i of issues) if (isAllowed(route, i.t)) i.allowed = true;
    if (finalPath.endsWith('/login') && !route.endsWith('/login'))
      issues.push({ t: 'redirected-to-login' });
    report.push({ route, finalPath, issues });
    const label = issues
      .map((x) => `${x.t}${x.n ? `(${x.n})` : ''}${x.allowed ? '[cho phép]' : ''}`)
      .join(', ');
    console.log(`${route.padEnd(34)} → ${finalPath.padEnd(30)} ${label || 'OK'}`);
  }
} finally {
  await browser.close();
}

await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));

const blocking = report.flatMap((r) =>
  r.issues.filter((i) => !i.allowed && !WARN_ONLY.has(i.t)).map((i) => `${r.route}|${i.t}`),
);
const warns = report.flatMap((r) =>
  r.issues.filter((i) => !i.allowed && WARN_ONLY.has(i.t)).map((i) => `${r.route}|${i.t}`),
);
const byType = {};
for (const r of report)
  for (const i of r.issues) if (!i.allowed) byType[i.t] = (byType[i.t] ?? 0) + 1;
console.log(
  `\nTổng ${report.length} route · lỗi chặn ${blocking.length} · cảnh báo ${warns.length}` +
    ` · theo loại ${JSON.stringify(byType)}\nBáo cáo: ${join(outDir, 'report.json')}`,
);
if (blocking.length) process.exitCode = 1;
