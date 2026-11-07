/** Thời gian dấu ✓ "đã sao chép" hiện trên nút trước khi quay về biểu tượng sao chép. */
export const COPIED_FLASH_MS = 1200;

/**
 * Liên kết chuẩn tới một công việc: `origin/issue/KEY`. Không mang `?peek=`/hash của trang đang mở
 * (khác `window.location.href`), nên dán ở đâu cũng mở đúng trang đầy đủ.
 */
export function issueUrl(key: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, '')}/issue/${encodeURIComponent(key)}`;
}

/** Ghép origin + đường dẫn trong ứng dụng (bỏ `/` thừa cuối origin). */
function appUrl(path: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/**
 * Liên kết TRONG ứng dụng tới một bảng tổng quan. Không phải liên kết công khai: mở được hay không vẫn do quyền xem của
 * người mở quyết định (đăng nhập + mức chia sẻ), liên kết không cấp thêm gì.
 */
export function dashboardUrl(id: string, origin: string = window.location.origin): string {
  return appUrl(`/dashboards/${encodeURIComponent(id)}`, origin);
}

/** Liên kết TRONG ứng dụng tới một bộ lọc đã lưu (nạp và chạy bộ lọc); cũng không cấp thêm quyền. */
export function filterUrl(id: string, origin: string = window.location.origin): string {
  return appUrl(`/filters/${encodeURIComponent(id)}`, origin);
}

/**
 * Chỗ DUY NHẤT gọi `navigator.clipboard` (test đọc-source canh). Thử Clipboard API trước; nếu không có
 * (HTTP thường — origin không bảo mật thì `navigator.clipboard` là `undefined`) hoặc trình duyệt từ chối,
 * lùi về `document.execCommand('copy')` (chạy được trên HTTP). Chỉ trả `false` khi cả hai đều không được.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API có nhưng bị từ chối quyền → thử cách cũ bên dưới.
  }
  return legacyCopy(text);
}

/**
 * Cách sao chép cũ cho ngữ cảnh không bảo mật (HTTP): tạo một `<textarea>` ẩn, chọn nội dung, gọi
 * `document.execCommand('copy')`. Không ném lỗi: môi trường không có DOM/execCommand thì trả `false`.
 */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok === true;
  } catch {
    return false;
  }
}
