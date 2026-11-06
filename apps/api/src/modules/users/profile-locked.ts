import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@tirapro/types';
import { AppException } from '../../common/exceptions/app.exception';

export const PROFILE_LOCKED_MESSAGE =
  'Chỉ Quản trị được đổi họ tên, email và ảnh đại diện — hãy liên hệ quản trị';

export function profileLockedException(): AppException {
  return new AppException(ERROR_CODES.PROFILE_LOCKED, PROFILE_LOCKED_MESSAGE, HttpStatus.FORBIDDEN);
}
