import { getAccessToken } from '@/lib/auth-token';

/** Đọc tên file từ header Content-Disposition (ưu tiên `filename*=UTF-8''…`), rơi về `fallback`. */
export function filenameFromDisposition(
  header: string | null | undefined,
  fallback: string,
): string {
  const disposition = header ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface DownloadOptions {
  params?: Record<string, string | number | undefined>;
  fallbackName?: string;
}

/**
 * Tải file từ API. Dùng fetch thuần (không qua axios) vì endpoint trả file đính kèm và
 * access token chỉ nằm trong bộ nhớ nên `<a href>` trực tiếp sẽ 401.
 */
export async function downloadFile(
  path: string,
  opts: DownloadOptions = {},
): Promise<{ filename: string; truncated: boolean }> {
  const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
  const token = getAccessToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const query = qs.toString();
  const res = await fetch(`${baseUrl}${path}${query ? `?${query}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? 'Bạn không có quyền xuất dữ liệu này.'
        : `Tải dữ liệu thất bại (HTTP ${res.status}).`,
    );
  }
  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get('Content-Disposition'),
    opts.fallbackName ?? 'tirapro-export',
  );
  saveBlob(blob, filename);
  return { filename, truncated: res.headers.get('X-Export-Truncated') === 'true' };
}

/** Tải nội dung dựng ở client (vd CSV từ dữ liệu đã có trong cache). */
export function downloadText(
  filename: string,
  text: string,
  mime = 'text/csv;charset=utf-8',
): void {
  saveBlob(new Blob([text], { type: mime }), filename);
}
