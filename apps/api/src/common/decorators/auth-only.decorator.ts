import { SetMetadata } from '@nestjs/common';

export const AUTH_ONLY_KEY = 'authOnly';
/**
 * Đánh dấu route CỐ Ý chỉ cần đăng nhập (không cần quyền RBAC) — vd dữ liệu của chính user.
 * Mọi route phải có `@Permissions`, `@Public` hoặc `@AuthOnly` (rbac-coverage.spec.ts kiểm tra);
 * luôn kèm comment nêu lý do.
 */
export const AuthOnly = () => SetMetadata(AUTH_ONLY_KEY, true);
