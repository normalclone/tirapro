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

/** Bắt mọi exception còn lại → error envelope chuẩn (§4.4). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthedRequest>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
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
    } else if (exception instanceof Error) {
      message = exception.message || message;
    }

    if (statusCode >= 500) {
      this.logger.error(
        `[${req.id}] ${req.method} ${req.url} -> ${statusCode}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(statusCode).json({
      success: false,
      error: { code, message, statusCode, ...(details ? { details } : {}) },
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
      case 422:
        return ERROR_CODES.BUSINESS_RULE_VIOLATION;
      case 429:
        return ERROR_CODES.RATE_LIMITED;
      default:
        return fallback;
    }
  }
}
