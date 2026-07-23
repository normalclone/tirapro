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
  RATE_LIMITED: 'RATE_LIMITED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
