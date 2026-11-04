import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode, type ErrorDetail } from '@tirapro/types';

/** Exception nghiệp vụ mang error code (map sang error envelope ở filter). */
export class AppException extends HttpException {
  constructor(
    // `string & {}` giữ gợi ý tự hoàn thành của ErrorCode mà vẫn cho mã tuỳ ý.
    public readonly code: ErrorCode | (string & {}),
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

/**
 * P-C14: cấp/gỡ `workspace:admin` (qua vai trò của thành viên hoặc qua bộ quyền của vai trò) chỉ dành cho người đang giữ
 * `workspace:admin` hoặc admin hệ thống — `member:manage` một mình không đủ. Mã riêng để web hiện đúng lý do.
 */
export class AdminGrantRequiresAdminException extends AppException {
  constructor(message = 'Chỉ quản trị không gian làm việc mới cấp hoặc gỡ quyền quản trị.') {
    super(ERROR_CODES.ADMIN_GRANT_REQUIRES_ADMIN, message, HttpStatus.FORBIDDEN);
  }
}

/** 403 mã riêng: ghi đè điểm tay chỉ dành cho Quản trị dự án/SA — web nhận ra mà không so khớp câu chữ. */
export class PointsOverrideForbiddenException extends AppException {
  constructor(
    message = 'Điểm tự tính theo Loại × Độ khó × Ưu tiên — chỉ Quản trị dự án mới chỉnh tay được. Hãy đổi Độ khó hoặc Ưu tiên.',
  ) {
    super(ERROR_CODES.POINTS_OVERRIDE_FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
}

/** 422 mã riêng: việc đang có việc con có điểm = tổng điểm việc con, không chỉnh tay được. */
export class PointsRollupOnlyException extends AppException {
  constructor(
    message = 'Việc này đang có việc con nên điểm là tổng điểm các việc con — không chỉnh tay được. Hãy sửa điểm của từng việc con.',
  ) {
    super(ERROR_CODES.POINTS_ROLLUP_ONLY, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 422 mã riêng: việc con luôn theo sprint của việc cha — không đặt sprint riêng cho việc con. */
export class ChildSprintFollowsParentException extends AppException {
  constructor(
    message = 'Việc con luôn nằm cùng sprint với việc cha — hãy đổi sprint của việc cha (việc con sẽ đi theo).',
  ) {
    super(ERROR_CODES.CHILD_SPRINT_FOLLOWS_PARENT, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 422 mã riêng: Epic không làm việc cha trong cây — gửi kèm một Epic khác thì không biết chọn Epic nào. */
export class ParentCannotBeEpicException extends AppException {
  constructor(
    message = 'Epic không làm việc cha — hãy gắn việc vào Epic bằng trường Epic, hoặc chọn một việc thường làm việc cha.',
  ) {
    super(ERROR_CODES.PARENT_CANNOT_BE_EPIC, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 422 mã riêng: Hạn bắt buộc, không được xoá trống — web/automation nhận ra mà không so khớp câu chữ. */
export class DueDateRequiredException extends AppException {
  constructor(message = 'Hạn là bắt buộc — chọn một ngày thay vì xoá trống') {
    super(ERROR_CODES.DUE_DATE_REQUIRED, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class VersionConflictException extends AppException {
  constructor(
    message = 'Dữ liệu đã thay đổi bởi người khác',
    public readonly current?: unknown,
  ) {
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

/** 409 với mã nghiệp vụ riêng (ALREADY_MEMBER, LAST_WORKSPACE_ADMIN…) để client nhận ra mà không so khớp câu chữ. */
export class ConflictAppException extends AppException {
  constructor(code: ErrorCode | (string & {}), message: string) {
    super(code, message, HttpStatus.CONFLICT);
  }
}

/** Email đã có tài khoản dùng được — mã riêng để client nhận ra mà không so khớp câu chữ. */
export class EmailAlreadyRegisteredException extends AppException {
  constructor(
    message = 'Email này đã có tài khoản — hãy chọn người đó trong danh sách để thêm vào không gian làm việc',
  ) {
    super(ERROR_CODES.EMAIL_ALREADY_REGISTERED, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** Mốc kéo-thả (afterId/beforeId) của client đã lỗi thời — thứ tự hai mốc bị đảo. Client tải lại danh sách rồi thả lại. */
export class RankNeighborsStaleException extends AppException {
  constructor(message = 'Thứ tự công việc vừa thay đổi — hãy tải lại danh sách rồi kéo thả lại') {
    super(ERROR_CODES.RANK_NEIGHBORS_STALE, message, HttpStatus.CONFLICT);
  }
}

/** Cột board đã đầy giới hạn WIP; client bắt code này để hỏi "Vẫn chuyển?" (chỉ quản trị dự án được ép). */
export class WipLimitReachedException extends AppException {
  constructor(message: string) {
    super(ERROR_CODES.WIP_LIMIT_REACHED, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
