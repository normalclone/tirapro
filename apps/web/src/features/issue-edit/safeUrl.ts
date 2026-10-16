// Chống XSS lưu trữ: chỉ cho phép scheme an toàn. Liên kết chặn javascript:/data:;
// riêng ảnh cho thêm data:image vì thẻ ảnh không chạy được mã từ nguồn này.
// `/` chỉ hợp lệ khi KHÔNG phải `//host` hay `/\host` (protocol-relative: trình duyệt hiểu là máy chủ ngoài).
const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?![\\/]))/i;
const SAFE_IMG = /^(https?:\/\/|data:image\/|\/(?![\\/]))/i;
// Trình duyệt bỏ tab/xuống dòng trong URL (`/\t/evil.com` thành `//evil.com`) nên ký tự điều khiển → từ chối hẳn.
const CONTROL = /[\u0000-\u001f\u007f]/;

function check(u: string, allow: RegExp): string | null {
  const t = u.trim();
  return !CONTROL.test(t) && allow.test(t) ? u : null;
}

export const safeHref = (u: string): string | null => check(u, SAFE_HREF);
export const safeImg = (u: string): string | null => check(u, SAFE_IMG);
