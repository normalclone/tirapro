import type { IssueEnvironment } from '@tirapro/types';

/** Đọc trình duyệt + hệ điều hành từ chuỗi User-Agent (không thêm thư viện). UA lạ → `{}`. */
export function parseUserAgent(ua: string): { browser?: string; os?: string } {
  const out: { browser?: string; os?: string } = {};
  const major = (re: RegExp) => re.exec(ua)?.[1];

  // Thứ tự quan trọng: Edge/Opera/Chrome-iOS/Firefox-iOS đều chứa "Chrome" hoặc "Safari".
  const edge = major(/\bEdg(?:e|A|iOS)?\/(\d+)/);
  const opera = major(/\bOPR\/(\d+)/);
  const firefox = major(/\b(?:Firefox|FxiOS)\/(\d+)/);
  const chrome = major(/\b(?:Chrome|CriOS)\/(\d+)/);
  const safari = /\bSafari\//.test(ua) ? major(/\bVersion\/(\d+)/) : undefined;
  if (edge) out.browser = `Edge ${edge}`;
  else if (opera) out.browser = `Opera ${opera}`;
  else if (firefox) out.browser = `Firefox ${firefox}`;
  else if (chrome) out.browser = `Chrome ${chrome}`;
  else if (safari) out.browser = `Safari ${safari}`;

  const ios = /\b(?:iPhone|iPad|iPod)\b/.test(ua) ? /\bOS (\d+)_(\d+)/.exec(ua) : null;
  if (ios) out.os = `iOS ${ios[1]}.${ios[2]}`;
  else if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) out.os = 'iOS';
  else if (/\bAndroid\b/.test(ua)) {
    const v = major(/\bAndroid (\d+)/);
    out.os = v ? `Android ${v}` : 'Android';
  } else if (/\bWindows NT 10\.0\b/.test(ua)) out.os = 'Windows 10/11';
  else if (/\bWindows\b/.test(ua)) out.os = 'Windows';
  else if (/\bCrOS\b/.test(ua)) out.os = 'ChromeOS';
  else if (/\bMac OS X\b/.test(ua)) out.os = 'macOS';
  else if (/\bLinux\b/.test(ua)) out.os = 'Linux';
  return out;
}

/**
 * Môi trường của phiên hiện tại: UA + độ phân giải màn hình + URL. Chỉ giữ `origin + pathname`
 * (bỏ query/hash — có thể chứa token). Người dùng luôn sửa được trước khi lưu/gửi.
 */
export function detectEnvironment(
  nav: { userAgent: string },
  scr: { width: number; height: number },
  loc: { origin: string; pathname: string },
): IssueEnvironment {
  const out: IssueEnvironment = { ...parseUserAgent(nav.userAgent) };
  if (scr.width > 0 && scr.height > 0) out.viewport = `${scr.width}×${scr.height}`;
  if (/^https?:\/\//i.test(loc.origin)) out.url = `${loc.origin}${loc.pathname}`;
  return out;
}

export const ENV_KIND_LABEL: Record<NonNullable<IssueEnvironment['env']>, string> = {
  production: 'Production',
  staging: 'Staging',
  dev: 'Dev',
  other: 'Khác',
};

/** Bản nháp form: mọi ô là chuỗi (rỗng = chưa điền). */
export interface EnvironmentDraft {
  env: string;
  browser: string;
  os: string;
  build: string;
  viewport: string;
  url: string;
}

export function toDraft(e: IssueEnvironment | null | undefined): EnvironmentDraft {
  return {
    env: e?.env ?? '',
    browser: e?.browser ?? '',
    os: e?.os ?? '',
    build: e?.build ?? '',
    viewport: e?.viewport ?? '',
    url: e?.url ?? '',
  };
}

/** Điền các ô từ môi trường phát hiện được, giữ nguyên ô người dùng đã chọn loại môi trường. */
export function mergeDetected(d: EnvironmentDraft, detected: IssueEnvironment): EnvironmentDraft {
  return {
    ...d,
    browser: detected.browser ?? d.browser,
    os: detected.os ?? d.os,
    viewport: detected.viewport ?? d.viewport,
    url: detected.url ?? d.url,
  };
}
