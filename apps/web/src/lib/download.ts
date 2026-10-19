import { refreshAccessToken } from './api';
import { getAccessToken } from './auth-token';

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
  // Thu hồi chậm: Safari cũ/Firefox có thể huỷ tải nếu URL bị thu hồi ngay sau click().
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface DownloadOptions {
  params?: Record<string, string | number | undefined>;
  fallbackName?: string;
}

/** Câu tiếng Việt cho lỗi HTTP khi tải file — nói được người dùng cần làm gì. */
export function downloadErrorMessage(status: number): string {
  if (status === 401) return 'Phiên đăng nhập đã hết hạn — hãy đăng nhập lại rồi tải lại.';
  if (status === 403) return 'Bạn không có quyền xuất dữ liệu này.';
  if (status === 404) return 'Không tìm thấy dữ liệu để xuất. Có thể nó vừa bị xoá.';
  if (status === 429) return 'Bạn thao tác hơi nhanh. Chờ vài giây rồi thử lại.';
  if (status >= 500) return 'Máy chủ gặp sự cố khi tạo tệp. Hãy thử lại sau ít phút.';
  return `Tải dữ liệu thất bại (HTTP ${status}).`;
}

async function fetchAuthed(url: string, token: string | null): Promise<Response> {
  try {
    return await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'include',
    });
  } catch {
    throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }
}

/** `X-Export-Rows` (số dòng dữ liệu, không tính tiêu đề) → số; thiếu/hỏng → null (không biết). */
function parseRows(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const n = Number(header);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Gọi API lấy file (chưa lưu). Access token chỉ nằm trong bộ nhớ nên `<a href>` trực tiếp sẽ 401; gặp 401 thì
 * refresh một lần theo cơ chế dùng chung của `api` client (single-flight) rồi thử lại đúng một lần.
 */
export async function fetchDownload(
  path: string,
  opts: DownloadOptions = {},
): Promise<{ blob: Blob; filename: string; truncated: boolean; rows: number | null }> {
  const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const query = qs.toString();
  const url = `${baseUrl}${path}${query ? `?${query}` : ''}`;

  let res = await fetchAuthed(url, getAccessToken());
  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (token) res = await fetchAuthed(url, token);
    else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tirapro:logout'));
  }
  if (!res.ok) throw new Error(downloadErrorMessage(res.status));
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(
      res.headers.get('Content-Disposition'),
      opts.fallbackName ?? 'tirapro-export',
    ),
    truncated: res.headers.get('X-Export-Truncated') === 'true',
    rows: parseRows(res.headers.get('X-Export-Rows')),
  };
}

/**
 * Tải file từ API rồi kích hoạt lưu về máy. `skipIfEmpty`: máy chủ báo 0 dòng dữ liệu (`X-Export-Rows: 0`) thì KHÔNG
 * lưu file chỉ có tiêu đề — nơi gọi báo "không có gì để xuất" (`saved: false`).
 */
export async function downloadFile(
  path: string,
  opts: DownloadOptions & { skipIfEmpty?: boolean } = {},
): Promise<{ filename: string; truncated: boolean; rows: number | null; saved: boolean }> {
  const { blob, filename, truncated, rows } = await fetchDownload(path, opts);
  if (opts.skipIfEmpty && rows === 0) return { filename, truncated, rows, saved: false };
  saveBlob(blob, filename);
  return { filename, truncated, rows, saved: true };
}

/** Tải nội dung dựng ở client (vd CSV từ dữ liệu đã có trong cache). */
export function downloadText(
  filename: string,
  text: string,
  mime = 'text/csv;charset=utf-8',
): void {
  saveBlob(new Blob([text], { type: mime }), filename);
}
