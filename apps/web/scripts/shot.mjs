// @ts-check
/**
 * Chụp màn hình app web đang chạy bằng Chrome hệ thống (qua playwright-core,
 * không tải browser riêng). Dùng để kiểm tra trực quan trong lúc phát triển.
 *
 * Ví dụ:
 *   node apps/web/scripts/shot.mjs --route=/filters --out=.shots/filters.png
 *   node apps/web/scripts/shot.mjs --route=/filters --viewport=mobile
 *   node apps/web/scripts/shot.mjs --route=/login --no-login           # trang công khai
 *
 * Cờ:
 *   --route       Đường dẫn SPA cần chụp (mặc định "/")
 *   --out         File PNG đầu ra (mặc định .shots/<slug>.png)
 *   --viewport    desktop (1440×900) | mobile (390×844)   (mặc định desktop)
 *   --base        Gốc URL (mặc định http://localhost:5173)
 *   --full        Chụp toàn trang (mặc định chỉ viewport)
 *   --no-login    Bỏ qua đăng nhập (cho trang public)
 *   --wait        Selector chờ trước khi chụp (mặc định body)
 * Env: SHOT_EMAIL / SHOT_PASSWORD ghi đè tài khoản đăng nhập demo.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return process.argv.includes(`--${name}`) ? true : fallback;
}

// Chuẩn hoá route: đảm bảo có "/" đầu (Git Bash có thể nuốt mất — xem ghi chú đầu file).
const route = '/' + String(arg('route', '/')).replace(/^\/+/, '');
const base = String(arg('base', 'http://localhost:5173')).replace(/\/$/, '');
const viewport = String(arg('viewport', 'desktop'));
const fullPage = arg('full', false) === true;
const noLogin = arg('no-login', false) === true;
const openNav = arg('open-nav', false) === true; // mở drawer sidebar (mobile) trước khi chụp
const waitSel = String(arg('wait', 'body'));
const slug = route.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'home';
const out = resolve(String(arg('out', `.shots/${slug}_${viewport}.png`)));

const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const size = SIZES[viewport] ?? SIZES.desktop;

const email = process.env.SHOT_EMAIL ?? 'admin@projira.dev';
const password = process.env.SHOT_PASSWORD ?? 'Password123';

// Chrome hệ thống trên Windows (ưu tiên), fallback Edge.
const CHANNELS = ['chrome', 'msedge'];

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

const browser = await launch();
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
const page = await ctx.newPage();

try {
  const debug = (m) => process.stderr.write(`[shot] ${m}\n`);
  if (!noLogin) {
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await page
      .waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 })
      .catch(() => debug('waitForURL after login timed out'));
    await page.waitForLoadState('networkidle').catch(() => {});
    debug(`after login url=${page.url()}`);
  }

  // SPA nav nếu có link trong sidebar (giữ token in-memory); fallback full goto (dựa refresh cookie).
  const link = page.locator(`a[href="${route}"]`).first();
  if ((await link.count()) > 0) {
    // Hamburger (lg:hidden) hiển thị ⇒ đang ở mobile ⇒ sidebar là drawer ẩn → mở trước.
    const burger = page.getByRole('button', { name: 'Mở menu' });
    if (await burger.isVisible().catch(() => false)) {
      await burger.click();
      await page.waitForTimeout(300);
    }
    await link.click();
    await page.waitForURL((u) => u.pathname === route, { timeout: 10000 }).catch(() => {});
    debug(`spa-nav url=${page.url()}`);
  } else {
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
    debug(`goto url=${page.url()}`);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForSelector(waitSel, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700); // chờ animation/skeleton lắng

  if (openNav) {
    const burger = page.getByRole('button', { name: 'Mở menu' });
    if (await burger.count()) {
      await burger.click();
      await page.waitForTimeout(400); // chờ drawer trượt xong
    }
  }
  debug(`final url=${page.url()}`);

  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage });
  console.log(out);
} finally {
  await browser.close();
}
