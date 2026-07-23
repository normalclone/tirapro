import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode, type ErrorDetail } from '@tirapro/types';

/** Exception nghiệp vụ mang error code (map sang error envelope ở filter). */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    status: HttpStatus,
    public readonly details?: ErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundAppException extends AppException {
  constructor(resource = 'Tài nguyên', code: string = ERROR_CODES.NOT_FOUND) {
    super(code, `${resource} không tồn tại`, HttpStatus.NOT_FOUND);
  }
}

export class ForbiddenAppException extends AppException {
  constructor(message = 'Bạn không có quyền thực hiện hành động này') {
    super(ERROR_CODES.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
}

export class VersionConflictException extends AppException {
  constructor(message = 'Dữ liệu đã thay đổi bởi người khác', public readonly current?: unknown) {
    super(ERROR_CODES.VERSION_CONFLICT, message, HttpStatus.CONFLICT);
  }
}

export class InvalidTransitionException extends AppException {
  constructor(message = 'Chuyển trạng thái không hợp lệ') {
    super(ERROR_CODES.INVALID_TRANSITION, message, HttpStatus.CONFLICT);
  }
}

export class BusinessRuleException extends AppException {
  constructor(message: string, details?: ErrorDetail[]) {
    super(ERROR_CODES.BUSINESS_RULE_VIOLATION, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class AiUnavailableException extends AppException {
  constructor(message = 'Tính năng AI hiện không khả dụng') {
    super(ERROR_CODES.AI_UNAVAILABLE, message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
