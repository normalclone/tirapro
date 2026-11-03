import type { AdminUser, UpdateAdminUserInput } from './api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lỗi từng ô của form sửa tài khoản ('' = hợp lệ). Lời nhắn nói rõ phải làm gì. */
export function validateAccountEdit(v: { displayName: string; email: string }): {
  displayName: string;
  email: string;
} {
  return {
    displayName: v.displayName.trim() ? '' : 'Hãy nhập tên hiển thị',
    email: !v.email.trim()
      ? 'Hãy nhập email đăng nhập'
      : EMAIL_RE.test(v.email.trim())
        ? ''
        : 'Email chưa đúng dạng — ví dụ ten@congty.com',
  };
}

/** Chỉ gửi trường thật sự đổi (email gửi dạng chữ thường); không đổi gì → null (nút Lưu bị khoá). */
export function buildAccountPatch(
  user: Pick<AdminUser, 'displayName' | 'email'>,
  v: { displayName: string; email: string },
): UpdateAdminUserInput | null {
  const patch: UpdateAdminUserInput = {};
  const name = v.displayName.trim();
  const email = v.email.trim().toLowerCase();
  if (name && name !== user.displayName) patch.displayName = name;
  if (email && email !== user.email.toLowerCase()) patch.email = email;
  return Object.keys(patch).length ? patch : null;
}
