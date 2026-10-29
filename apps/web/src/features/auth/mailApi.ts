import { useMutation } from '@tanstack/react-query';
import type { ForgotPasswordInput, ResetPasswordInput } from '@tirapro/shared';
import { api } from '@/lib/api';

/** Gửi liên kết đặt lại mật khẩu. Server luôn trả thành công dù email có tồn tại hay không. */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (v: ForgotPasswordInput) =>
      api.post<{ success: true }>('/auth/forgot-password', v).then((r) => r.data),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (v: ResetPasswordInput) =>
      api.post<{ success: true }>('/auth/reset-password', v).then((r) => r.data),
  });
}
