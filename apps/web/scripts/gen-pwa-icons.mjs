// @ts-check
/**
 * Sinh icon PWA (192×192 và 512×512) từ public/favicon.svg bằng playwright-core.
 * Chạy lại mỗi khi đổi favicon.svg rồi commit hai file PNG:
 *
 *   node apps/web/scripts/gen-pwa-icons.mjs
 *
 * Dùng Chromium của Playwright (~/Library/Caches/ms-playwright); nếu chưa có thì rơi về Chrome/Edge cài sẵn trên máy.
 * Nền trong suốt (omitBackground) để giữ góc bo của favicon.
 */
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SIZES = [192, 512];
const publicDir = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', publicDir), 'utf8');

async function launch() {
  /** @type {Array<Parameters<typeof chromium.launch>[0]>} */
  const attempts = [
    { headless: true },
    { channel: 'chrome', headless: true },
    { channel: 'msedge', headless: true },
  ];
  let lastError;
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `Không mở được trình duyệt để vẽ icon: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

const browser = await launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const html =
      `<!doctype html><html><body style="margin:0;background:transparent">` +
      `<div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`;
    await page.setContent(html);
    const png = await page.screenshot({
      type: 'png',
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    const out = new URL(`icon-${size}.png`, publicDir);
    await writeFile(out, png);
    console.log(`Đã ghi ${fileURLToPath(out)} (${png.length} byte)`);
    await page.close();
  }
} finally {
  await browser.close();
}
