/** Thời gian dấu ✓ "đã sao chép" hiện trên nút trước khi quay về biểu tượng sao chép. */
export const COPIED_FLASH_MS = 1200;

/**
 * Liên kết chuẩn tới một công việc: `origin/issue/KEY`. Không mang `?peek=`/hash của trang đang mở
 * (khác `window.location.href`), nên dán ở đâu cũng mở đúng trang đầy đủ.
 */
export function issueUrl(key: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, '')}/issue/${encodeURIComponent(key)}`;
}

/**
 * Chỗ DUY NHẤT gọi `navigator.clipboard` (test đọc-source canh). Trả `false` thay vì ném lỗi: HTTP thường
 * không có `navigator.clipboard`, hoặc trình duyệt từ chối quyền.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
