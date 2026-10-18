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
 *   --dialogs       Đo HỘP THOẠI thay vì trang: với mỗi kịch bản (DIALOG_SCENARIOS) mở hộp rồi đo trong
 *                   `[role=dialog]` trên cùng (cùng phép đo như trang + dialog-offscreen, dialog-action-cut,
 *                   dialog-h-scroll). Kịch bản thiếu dữ liệu để mở (vd chưa có sprint tương lai) được báo "bỏ qua".
 *   --only=a,b      (với --dialogs) chỉ chạy các kịch bản tên a, b
 * Env: AUDIT_PROJECT (mặc định DEMO), AUDIT_ISSUE (mặc định DEMO-STORY-1),
 *      SHOT_EMAIL / SHOT_PASSWORD (mặc định admin@projira.dev / Password123, như shot.mjs).
 *
 * Phát hiện (heuristic, đủ bắt lỗi thật, ít nhiễu):
 *   page-h-scroll      trang cuộn ngang (scrollWidth > 391)
 *   overflow-right     phần tử trong main/header tràn mép phải, không nằm trong vùng cuộn ngang
 *   squeezed-text      chữ ≥ 8 ký tự, ≥ 4 dòng nhưng rộng < 140px
 *   covered-by-fixed   nút/link/ô nhập trong màn hình đầu bị phần tử position:fixed (rộng < 120px) che ≥ 30% (từ khi bỏ nút nổi dưới lg, loại này hiếm; che bởi thanh tab đáy xem bottom-bar-overlap)
 *   bottom-bar-missing / bottom-bar-overlap
 *                      (dưới lg) thanh tab đáy không hiện, hoặc <main>/phần tử fixed chồng lên thanh (che điều khiển)
 *   text-overlap       hai phần tử lá có chữ giao nhau > 4×4px (không lồng nhau)
 *   header-offscreen   nút/link trong header dự án có right > 390 (trên màn hình)
 *   touch-overlap      vùng bấm mở rộng (pseudo-element ::after tuyệt đối trên nút/link, vd TOUCH_HIT) đè lên một
 *                      điều khiển kề > 1×1px — vùng chạm chồng lên nhau gây bấm nhầm
 *   dialog-offscreen   (--dialogs) hộp thoại tràn ra ngoài màn hình
 *   dialog-action-cut  (--dialogs) nút hành động ngoài vùng cuộn của hộp bị cắt khỏi khung nhìn
 *   dialog-h-scroll    (--dialogs) nội dung hộp cuộn ngang
 *   input-font-small   ô nhập (input/textarea/select) có font-size tính toán < 16px — iOS Safari phóng to trang khi focus
 *   small-targets      > 6 nút/link cao hiệu dụng < 28px (tính cả vùng bấm mở rộng ::after) (CẢNH BÁO — không làm exit code = 1)
 *
 * Giới hạn heuristic: `text-overlap` chỉ so mỗi phần tử lá với 40 phần tử kế tiếp theo thứ tự DOM nên sót chữ
 * đè nhau ở xa nhau trong DOM (vd hai cột bố trí lệch); phát hiện 404 dựa vào 400 ký tự đầu của trang.
 *
 * Allowlist `mobile-audit.allow.json`: { "<route>|<loại>": "lý do" }. Route có thể viết thô hoặc thay
 * khoá dự án / mã công việc bằng `:project` / `:issue`.
 * Exit code 1 nếu còn lỗi (trừ cảnh báo) ngoài allowlist.
 * Lưu ý: `small-targets` vốn là cảnh báo (WARN_ONLY, không bao giờ làm exit 1) nên cho vào allowlist chỉ để
 * ẩn khỏi báo cáo, KHÔNG phải ngoại lệ thật. Chỉ các loại chặn mới cần allowlist có lý do.
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
const dialogsMode = arg('dialogs', false) === true;
const onlyArg = arg('only', '');
const only = typeof onlyArg === 'string' && onlyArg ? onlyArg.split(',') : null;
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
function measure({ W, H, isProjectRoute, dialog = false }) {
  // Trang: đo trong `main`; hộp thoại: đo trong phần tử đã gắn `data-audit-root` (hộp thoại trên cùng).
  const R = dialog ? '[data-audit-root]' : 'main';
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
  // Bị cắt khuất bởi khung cuộn/overflow của tổ tiên (vd thẻ cuộn dưới đáy cột Board) → người dùng không thấy/không bấm được.
  const clippedAway = (el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const q = p.getBoundingClientRect();
      const ix = Math.min(r.right, q.right) - Math.max(r.left, q.left);
      const iy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (ix < r.width / 2 || iy < r.height / 2) return true;
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
  for (const el of document.querySelectorAll(dialog ? `${R} *` : 'main *, header *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 2 && !inScroller(el)) over.push(desc(el) + ' right=' + Math.round(r.right));
  }
  if (over.length) issues.push({ t: 'overflow-right', n: over.length, sample: over.slice(0, 4) });

  // (3) chữ bị bóp thành cột hẹp
  const narrow = [];
  for (const el of document.querySelectorAll(
    ['h1', 'h2', 'h3', 'p', 'button', 'a', 'span', 'label'].map((t) => `${R} ${t}`).join(','),
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
  for (const f of dialog ? [] : fixed) {
    const fr = f.getBoundingClientRect();
    for (const el of document.querySelectorAll(
      ['button', 'a', 'input', 'select', '[role=button]'].map((t) => `${R} ${t}`).join(','),
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

  // (4b) thanh tab đáy (dưới lg): phải hiện, nằm TRONG luồng (đáy <main> chạm đỉnh thanh, không chồng) và không có
  // phần tử fixed nào (nút nổi, thanh dính…) phủ lên nó → không điều khiển bấm được nào bị thanh che.
  if (!dialog && document.querySelector('#app-sidebar') && W < 1024) {
    const bar = document.querySelector('nav[aria-label="Điều hướng chính"]');
    const br = bar?.getBoundingClientRect();
    if (!bar || !br || br.height < 40 || br.bottom > H + 1) {
      issues.push({ t: 'bottom-bar-missing', n: 1 });
    } else {
      const main = document.querySelector('main');
      const bad = [];
      if (main && main.getBoundingClientRect().bottom > br.top + 1)
        bad.push('main chồng lên thanh');
      for (const f of document.querySelectorAll('*')) {
        if (getComputedStyle(f).position !== 'fixed' || !vis(f) || bar.contains(f)) continue;
        if (f.closest('[role=dialog], [data-sonner-toaster], .driver-popover, .driver-overlay'))
          continue;
        const fr = f.getBoundingClientRect();
        if (
          fr.bottom > br.top + 1 &&
          fr.top < br.bottom &&
          fr.right > br.left &&
          fr.left < br.right
        )
          bad.push(desc(f));
      }
      if (bad.length)
        issues.push({ t: 'bottom-bar-overlap', n: bad.length, sample: bad.slice(0, 4) });
    }
  }

  // (5) chữ chồng nhau
  const leaves = [...document.querySelectorAll(`${R} *`)].filter(
    (e) =>
      vis(e) &&
      e.children.length === 0 &&
      (e.textContent || '').trim().length > 1 &&
      !clippedAway(e),
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
  if (isProjectRoute && !dialog) {
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

  // Hình học vùng bấm mở rộng (::after tuyệt đối) của một điều khiển, hoặc null.
  const hitBox = (el) => {
    const ps = getComputedStyle(el, '::after');
    if (ps.position !== 'absolute' || ps.content === 'none' || ps.content === 'normal') return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const l = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(ps.left);
    const t = r.top + parseFloat(cs.borderTopWidth) + parseFloat(ps.top);
    const w = parseFloat(ps.width);
    const h = parseFloat(ps.height);
    return [l, t, w, h].some((n) => Number.isNaN(n)) ? null : { l, t, w, h };
  };

  // (8) vùng bấm mở rộng bằng ::after (TOUCH_HIT/CHIP_TOUCH_HIT, chỉ khi pointer:coarse — ngữ cảnh đo là cảm ứng)
  // không được phủ lên điều khiển kề. Đo hình học của pseudo-element qua getComputedStyle(el, '::after').
  const controls = [
    ...document.querySelectorAll(
      dialog
        ? `${R} a[href], ${R} button, ${R} input, ${R} select, ${R} textarea, ${R} [role=button]`
        : 'main a[href], main button, main input, main select, main textarea, main [role=button], header a[href], header button',
    ),
  ].filter((e) => vis(e) && !clippedAway(e));
  const hitOver = [];
  for (const el of controls) {
    const hb = hitBox(el);
    if (!hb) continue;
    const { l, t, w, h } = hb;
    // Liên kết kéo giãn (stretched link: ::after phủ cả thẻ cha) là chủ ý — chỉ xét phần mở rộng sát điều khiển (< 60px).
    const own = el.getBoundingClientRect();
    if (w > own.width + 60 || h > own.height + 60) continue;
    for (const o of controls) {
      if (o === el || o.contains(el) || el.contains(o)) continue;
      // So với vùng bấm của điều khiển kề (nếu nó cũng mở rộng) hoặc hộp của nó — hai vùng bấm không được chồng nhau.
      const ob = hitBox(o);
      const orect = o.getBoundingClientRect();
      const oStretched = ob && (ob.w > orect.width + 60 || ob.h > orect.height + 60);
      const q =
        ob && !oStretched
          ? { left: ob.l, top: ob.t, right: ob.l + ob.w, bottom: ob.t + ob.h }
          : orect;
      const ix = Math.min(l + w, q.right) - Math.max(l, q.left);
      const iy = Math.min(t + h, q.bottom) - Math.max(t, q.top);
      if (ix > 1 && iy > 1) {
        hitOver.push(desc(el) + ' × ' + desc(o));
        break;
      }
    }
  }
  if (hitOver.length)
    issues.push({ t: 'touch-overlap', n: hitOver.length, sample: hitOver.slice(0, 4) });

  // (12) ô nhập chữ < 16px: iOS Safari tự phóng to trang khi focus. Đo font-size tính toán thật (đã qua cascade).
  const NO_TEXT_INPUT = new Set([
    'checkbox',
    'radio',
    'range',
    'color',
    'file',
    'hidden',
    'submit',
    'button',
    'image',
    'reset',
  ]);
  const smallInputs = [...document.querySelectorAll(`${R} input, ${R} textarea, ${R} select`)]
    .filter((e) => vis(e) && !NO_TEXT_INPUT.has((e.getAttribute('type') || '').toLowerCase()))
    .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16 - 0.01)
    .map((e) => desc(e) + ' ' + getComputedStyle(e).fontSize);
  if (smallInputs.length)
    issues.push({ t: 'input-font-small', n: smallInputs.length, sample: smallInputs.slice(0, 4) });

  // (6) vùng chạm nhỏ (cảnh báo)
  const smallEls = [
    ...document.querySelectorAll(`${R} button, ${R} a[href], ${R} [role=button]`),
  ].filter(
    // Chiều cao hiệu dụng = lớn hơn giữa phần tử và vùng bấm mở rộng (TOUCH_HIT…) — cảm ứng bấm theo vùng đó.
    (e) =>
      vis(e) &&
      Math.max(e.getBoundingClientRect().height, hitBox(e)?.h ?? 0) < 28 &&
      e.getBoundingClientRect().bottom < 4000,
  );
  const small = smallEls.length;
  // Định nghĩa CŨ (chỉ chiều cao phần tử, không tính vùng bấm mở rộng) — để so trước/sau cùng thước đo.
  window.__auditSmallElem = [
    ...document.querySelectorAll(`${R} button, ${R} a[href], ${R} [role=button]`),
  ].filter(
    (e) =>
      vis(e) && e.getBoundingClientRect().height < 28 && e.getBoundingClientRect().bottom < 4000,
  ).length;
  window.__auditSmall = small; // số thô (kể cả ≤ 6) để báo cáo trước/sau
  if (small > 6)
    issues.push({
      t: 'small-targets',
      n: small,
      sample: smallEls
        .slice(0, 8)
        .map((e) => desc(e) + ' h=' + Math.round(e.getBoundingClientRect().height)),
    });

  if (dialog) {
    const dlg = document.querySelector(R);
    if (dlg) {
      const dr = dlg.getBoundingClientRect();
      // (9) hộp thoại phải nằm trọn trong màn hình (ngang + dọc)
      if (dr.left < -1 || dr.right > W + 1 || dr.top < -1 || dr.bottom > H + 1)
        issues.push({
          t: 'dialog-offscreen',
          sample: [
            `l=${Math.round(dr.left)} r=${Math.round(dr.right)} t=${Math.round(dr.top)} b=${Math.round(dr.bottom)}`,
          ],
        });
      // (10) nút hành động nằm ngoài vùng cuộn của hộp (footer cố định) phải thấy được trọn trong khung nhìn;
      // nút nằm TRONG vùng cuộn thì được phép nằm dưới (cuộn tới).
      const inVScroller = (el) => {
        for (let p = el.parentElement; p && p !== dlg.parentElement; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY;
          if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
        }
        return false;
      };
      const cut = [];
      for (const b of dlg.querySelectorAll('button, a[href]')) {
        if (!vis(b) || inVScroller(b) || b.getAttribute('aria-label') === 'Đóng') continue;
        const r = b.getBoundingClientRect();
        if (r.bottom > H + 1 || r.top < -1 || r.right > W + 1 || r.left < -1)
          cut.push(desc(b) + ` b=${Math.round(r.bottom)} r=${Math.round(r.right)}`);
      }
      if (cut.length)
        issues.push({ t: 'dialog-action-cut', n: cut.length, sample: cut.slice(0, 4) });
      // (11) nội dung hộp cuộn ngang
      if (dlg.scrollWidth > dlg.clientWidth + 1)
        issues.push({ t: 'dialog-h-scroll', n: dlg.scrollWidth - dlg.clientWidth });
    }
  }

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

/** Hướng dẫn lần đầu (driver.js) phủ lên trang làm lệch phép đo/ảnh — đóng nếu đang mở (server ghi nhớ "đã xem"). */
async function dismissTour(page) {
  for (let i = 0; i < 3; i++) {
    const btn = page.locator('.driver-popover-close-btn');
    if (!(await btn.count())) return;
    await btn
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await page.waitForTimeout(300);
  }
  // Bấm đóng tour để lại con trỏ/tiêu điểm trên trang → tooltip nổi (fixed) che nút gây báo sai: bỏ con trỏ + tiêu điểm.
  await page.mouse.move(0, 0).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
  await page.waitForTimeout(250);
}

/** Kịch bản hộp thoại (`--dialogs`): `route` (SPA) → `open(page)` mở hộp. Ném lỗi `SKIP: lý do` nếu không đủ dữ liệu. */
const clickText = (page, name, opts = {}) =>
  page
    .getByRole('button', { name, ...opts })
    .first()
    .click({ timeout: 4000 });
const needs = async (loc, why) => {
  // Dữ liệu có thể về chậm sau khi trang vẽ xong — chờ ngắn trước khi coi là thiếu.
  const ok = await loc
    .first()
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) throw new Error(`SKIP: ${why}`);
};
const fire = (page, ev) => page.evaluate((e) => window.dispatchEvent(new Event(e)), ev);
const DIALOG_SCENARIOS = [
  { name: 'tao-cong-viec', route: `${P}/board`, open: (pg) => clickText(pg, 'Tạo công việc') },
  { name: 'bao-loi-co-ban', route: `${P}/board`, open: (pg) => clickText(pg, /Báo lỗi/) },
  {
    name: 'bao-loi-nang-cao',
    route: `${P}/board`,
    open: async (pg) => {
      await clickText(pg, /Báo lỗi/);
      await pg.waitForSelector('[role=dialog]');
      await pg.getByRole('radio', { name: 'Nâng cao' }).first().click({ timeout: 3000 });
    },
  },
  { name: 'cmd-k', route: '/', open: (pg) => fire(pg, 'tirapro:command') },
  { name: 'phim-tat', route: '/', open: (pg) => fire(pg, 'tirapro:shortcuts') },
  {
    name: 'tro-ly-lap-sprint',
    route: `${P}/backlog`,
    open: async (pg) => {
      await needs(
        pg.getByRole('button', { name: 'Trợ lý lập sprint' }),
        'chưa có sprint tương lai',
      );
      await clickText(pg, 'Trợ lý lập sprint');
    },
  },
  {
    name: 'ket-thuc-sprint',
    route: `${P}/backlog`,
    open: async (pg) => {
      await needs(pg.getByRole('button', { name: /Kết thúc sprint/ }), 'chưa có sprint đang chạy');
      await clickText(pg, /Kết thúc sprint/);
    },
  },
  { name: 'them-nhieu-nguoi', route: '/members', open: (pg) => clickText(pg, 'Thêm nhiều người') },
  { name: 'tao-vai-tro', route: '/settings/roles', open: (pg) => clickText(pg, /Tạo vai trò/) },
  {
    name: 'tao-bo-loc',
    route: '/filters',
    open: async (pg) => {
      // < lg: rail "Bộ lọc đã lưu" thu gọn mặc định — mở ra rồi mới thấy nút.
      const toggle = pg.getByRole('button', { name: /Bộ lọc đã lưu/ }).first();
      if ((await toggle.count()) && (await toggle.getAttribute('aria-expanded')) === 'false')
        await toggle.click();
      await clickText(pg, 'Tạo bộ lọc');
    },
  },
  {
    name: 'quick-assign',
    route: `${P}/backlog`,
    open: async (pg) => {
      await needs(pg.locator('[data-nav-item]'), 'chưa có dòng công việc');
      await pg.locator('[data-nav-item]').first().focus();
      await pg.keyboard.press('a');
    },
  },
  {
    name: 'digest-bao-cao-dinh-ky',
    route: '/connect/integrations?section=digest',
    open: async (pg) => {
      await needs(
        pg.getByRole('button', { name: /Tạo báo cáo định kỳ/ }),
        'không có nút tạo báo cáo',
      );
      await clickText(pg, /Tạo báo cáo định kỳ/);
    },
  },
  {
    name: 'telegram-wizard',
    route: '/connect/integrations?section=telegram',
    open: async (pg) => {
      await needs(
        pg.getByRole('button', { name: /Kết nối Telegram/ }),
        'không có nút kết nối Telegram',
      );
      await clickText(pg, /Kết nối Telegram/);
    },
  },
  {
    name: 'okr-check-in',
    route: '/manage/goals',
    open: async (pg) => {
      await needs(pg.getByRole('button', { name: /Check-in/ }), 'chưa có KR nhập tay');
      await clickText(pg, /Check-in/);
    },
  },
];

const allow = await loadAllow();
/**
 * Khoá allowlist: `<route>|<loại>` (cả route) hoặc `<route>|<loại>~<mẫu>` (chỉ khi MỌI phần tử trong `sample` của lỗi có
 * chứa <mẫu> — thu hẹp theo phần tử để lỗi thật khác trên cùng route không bị che; lỗi không có `sample` đầy đủ không khớp).
 */
const isAllowed = (route, issue) => {
  const keys = [route, tokenize(route)].map((r) => `${r}|${issue.t}`);
  if (keys.some((k) => k in allow)) return true;
  const samples = issue.sample ?? [];
  if (!samples.length || (issue.n ?? samples.length) > samples.length) return false;
  return Object.keys(allow).some((k) => {
    const [head, needle] = k.split('~');
    return needle && keys.includes(head) && samples.every((x) => x.includes(needle));
  });
};

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

  const spaGo = async (route) => {
    await page.evaluate((p) => {
      window.history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, route);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
    await dismissTour(page);
  };

  if (dialogsMode) {
    for (const sc of DIALOG_SCENARIOS.filter((x) => !only || only.includes(x.name))) {
      const key = `dialog:${sc.name}`;
      await spaGo(sc.route);
      try {
        await sc.open(page);
        await page.waitForSelector('[role=dialog]', { timeout: 4000 });
        await page.waitForTimeout(500);
      } catch (e) {
        const msg = String(e?.message ?? e);
        const why =
          msg.startsWith('Error: SKIP:') || msg.startsWith('SKIP:')
            ? msg.replace(/^Error: /, '')
            : `KHÔNG MỞ ĐƯỢC: ${msg.split('\n')[0]}`;
        const hard = !why.startsWith('SKIP:');
        report.push({
          route: key,
          finalPath: sc.route,
          issues: hard ? [{ t: 'dialog-not-opened', sample: [why] }] : [],
          skipped: hard ? undefined : why.slice(5).trim(),
        });
        console.log(`${key.padEnd(34)} → ${hard ? why : `bỏ qua (${why.slice(5).trim()})`}`);
        await page.keyboard.press('Escape').catch(() => {});
        continue;
      }
      await page.evaluate(() => {
        const all = [...document.querySelectorAll('[role=dialog]')];
        document
          .querySelectorAll('[data-audit-root]')
          .forEach((e) => e.removeAttribute('data-audit-root'));
        all.at(-1)?.setAttribute('data-audit-root', '');
      });
      await page.screenshot({ path: join(outDir, `dlg-${sc.name}.png`), fullPage: false });
      const issues = await page.evaluate(measure, { W, H, isProjectRoute: false, dialog: true });
      for (const i of issues) if (isAllowed(key, i)) i.allowed = true;
      report.push({ route: key, finalPath: sc.route, issues });
      const label = issues
        .map((x) => `${x.t}${x.n ? `(${x.n})` : ''}${x.allowed ? '[cho phép]' : ''}`)
        .join(', ');
      console.log(`${key.padEnd(34)} → ${sc.route.padEnd(30)} ${label || 'OK'}`);
      // đóng hết hộp (có thể lồng) trước kịch bản kế tiếp
      for (let k = 0; k < 3 && (await page.locator('[role=dialog]').count()); k++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
    }
    ROUTES.length = 0;
  }

  for (const route of ROUTES) {
    await spaGo(route);
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
    for (const i of issues) if (isAllowed(route, i)) i.allowed = true;
    if (finalPath.endsWith('/login') && !route.endsWith('/login'))
      issues.push({ t: 'redirected-to-login' });
    const smallTargets = await page.evaluate(() => window.__auditSmall ?? 0);
    const smallElem = await page.evaluate(() => window.__auditSmallElem ?? 0);
    report.push({ route, finalPath, issues, smallTargets, smallElem });
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
const smallTotal = report.reduce((a, r) => a + (r.smallTargets ?? 0), 0);
const smallElemTotal = report.reduce((a, r) => a + (r.smallElem ?? 0), 0);
const smallElemRoutes = report.filter((r) => (r.smallElem ?? 0) > 6);
const byType = {};
for (const r of report)
  for (const i of r.issues) if (!i.allowed) byType[i.t] = (byType[i.t] ?? 0) + 1;
console.log(
  `\nTổng ${report.length} route · lỗi chặn ${blocking.length} · cảnh báo ${warns.length}` +
    ` · vùng chạm nhỏ: hiệu dụng (gồm vùng bấm mở rộng) ${smallTotal}, theo chiều cao phần tử (định nghĩa cũ) ${smallElemTotal} (${smallElemRoutes.length} route > 6: ${smallElemRoutes.reduce((a, r) => a + r.smallElem, 0)} phần tử) · theo loại ${JSON.stringify(byType)}\nBáo cáo: ${join(outDir, 'report.json')}`,
);
if (blocking.length) process.exitCode = 1;
