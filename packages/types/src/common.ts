/** Kiểu envelope/pagination/error dùng chung REST. */

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

export interface CursorPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
  limit: number;
}

export interface OffsetPageInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ListResponse<T> {
  success: true;
  data: T[];
  pageInfo: CursorPageInfo | OffsetPageInfo;
  meta: ResponseMeta;
}

export interface ErrorDetail {
  field?: string;
  code: string;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: ErrorDetail[];
  };
  meta: ResponseMeta & { path?: string };
}

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  JQL_PARSE_ERROR: 'JQL_PARSE_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  /** Tạo tài khoản với email đã có tài khoản (đang dùng được) — client chuyển sang chọn người có sẵn. */
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  /** Cột board đã đạt giới hạn WIP — client có thể hỏi "Vẫn chuyển?" (chỉ quản trị dự án được ép). */
  WIP_LIMIT_REACHED: 'WIP_LIMIT_REACHED',
  RATE_LIMITED: 'RATE_LIMITED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_MISCONFIGURED: 'AI_MISCONFIGURED',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  /** Mốc kéo-thả (afterId/beforeId) của client đã cũ — thứ tự hai mốc đảo; client nạp lại danh sách rồi thả lại. */
  RANK_NEIGHBORS_STALE: 'RANK_NEIGHBORS_STALE',
  CONFLICT: 'CONFLICT',
  /** Thêm người đã là thành viên (không âm thầm ghi đè vai trò) — đổi vai trò ở trang Thành viên. */
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  /** Hạ/gỡ quản trị workspace cuối cùng — workspace sẽ không còn ai quản trị. */
  LAST_WORKSPACE_ADMIN: 'LAST_WORKSPACE_ADMIN',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
