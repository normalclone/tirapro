import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@tirapro/types';
import { AppException } from './exceptions/app.exception';

/**
 * Mục tiêu / rủi ro / chính sách thời gian xử lý luôn thuộc MỘT dự án (không còn cấp tổ chức): thiếu `projectId` (hoặc
 * xoá trống khi sửa) → 422 `PROJECT_REQUIRED`. Trả lại id đã thu hẹp kiểu `string` để caller dùng tiếp.
 */
export function requireProjectId(projectId: string | null | undefined, what: string): string {
  if (!projectId)
    throw new AppException(
      ERROR_CODES.PROJECT_REQUIRED,
      `Chọn dự án cho ${what} — mục này luôn thuộc một dự án`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  return projectId;
}
