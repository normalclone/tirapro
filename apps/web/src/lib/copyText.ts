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
 *
 * TIRA-BUG-26: nút này thường bấm từ TRONG hộp thoại/popover chia sẻ (Radix có bẫy focus). Nếu textarea
 * gắn vào `document.body` (ngoài vùng bẫy) thì ngay khi `select()` làm nó nhận focus, bẫy focus giành focus
 * về lại hộp thoại → vùng chọn của textarea không còn là vùng chọn hiện hành → `execCommand('copy')` trả
 * `true` nhưng clipboard RỖNG ("đã sao chép" mà Ctrl+V không ra gì). Khắc phục: gắn textarea vào cùng vùng
 * với phần tử đang focus (nằm trong bẫy), `focus()` trước `select()`, rồi trả focus về chỗ cũ.
 */
function legacyCopy(text: string): boolean {
  const active = (typeof document !== 'undefined' ? document.activeElement : null) as
    | (HTMLElement & { parentElement?: HTMLElement | null })
    | null;
  const host = active?.parentElement ?? document.body;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // Giữ trong khung nhìn nhưng gần như vô hình: để ở `-9999px` một số trình duyệt từ chối chép, và
  // `focus()` vào phần tử ngoài màn hình còn làm trang nhảy.
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.padding = '0';
  ta.style.border = 'none';
  ta.style.opacity = '0';
  try {
    host.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    ta.remove();
    active?.focus?.();
  }
}
