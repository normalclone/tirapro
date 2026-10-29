import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES, type ErrorDetail } from '@tirapro/types';
import { AppException } from '../exceptions/app.exception';
import type { AuthedRequest } from '../types/request';

/** Thông báo chung cho lỗi 500 ở production — chi tiết chỉ nằm trong log server. */
/** multer ném `File too large` (413) khi vượt `limits.fileSize` — Việt hoá, mã `PAYLOAD_TOO_LARGE`. */
export const FILE_TOO_LARGE_MESSAGE =
  'Tệp quá lớn — vượt giới hạn dung lượng của chức năng này (biểu mẫu Excel tối đa 5 MB). Hãy giảm dung lượng hoặc chia thành nhiều tệp nhỏ hơn';

export const INTERNAL_ERROR_MESSAGE =
  'Lỗi hệ thống — hãy thử lại, nếu vẫn lỗi hãy báo quản trị kèm mã yêu cầu';

/** Bắt mọi exception còn lại → error envelope chuẩn (§4.4). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthedRequest>();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL;
    let message = 'Đã có lỗi xảy ra';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof AppException) {
      statusCode = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (resp && typeof resp === 'object') {
        const r = resp as Record<string, unknown>;
        // ValidationPipe trả { message: string[] | string, error, statusCode }
        const rawMsg = r.message;
        if (Array.isArray(rawMsg)) {
          code = ERROR_CODES.VALIDATION_ERROR;
          message = 'Dữ liệu không hợp lệ';
          details = rawMsg.map((m) => ({ code: 'INVALID', message: String(m) }));
        } else if (typeof rawMsg === 'string') {
          message = rawMsg;
        }
      }
      code = this.codeFromStatus(statusCode, code);
      if (statusCode === 413 && message === 'File too large') message = FILE_TOO_LARGE_MESSAGE;
    } else if (exception instanceof Error) {
      // Lỗi không lường trước: ở production không lộ message nội bộ (SQL, đường dẫn, stack...) ra client.
      message =
        process.env.NODE_ENV === 'production'
          ? INTERNAL_ERROR_MESSAGE
          : exception.message || message;
    } else if (process.env.NODE_ENV === 'production') {
      message = INTERNAL_ERROR_MESSAGE;
    }

    if (statusCode >= 500) {
      // Log đầy đủ phía server (message gốc + stack), kể cả khi client chỉ thấy thông báo chung.
      const original = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `[${req.id}] ${req.method} ${req.url} -> ${statusCode}: ${original}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        statusCode,
        ...(details ? { details } : {}),
        ...(statusCode >= 500 ? { requestId: req.id } : {}),
      },
      meta: { requestId: req.id, timestamp: new Date().toISOString(), path: req.url },
    });
  }

  private codeFromStatus(status: number, fallback: string): string {
    switch (status) {
      case 400:
        return ERROR_CODES.VALIDATION_ERROR;
      case 401:
        return ERROR_CODES.UNAUTHENTICATED;
      case 403:
        return ERROR_CODES.FORBIDDEN;
      case 404:
        return ERROR_CODES.NOT_FOUND;
      case 409:
        return ERROR_CODES.CONFLICT;
      case 413:
        return ERROR_CODES.PAYLOAD_TOO_LARGE;
      case 422:
        return ERROR_CODES.BUSINESS_RULE_VIOLATION;
      case 429:
        return ERROR_CODES.RATE_LIMITED;
      default:
        return fallback;
    }
  }
}
