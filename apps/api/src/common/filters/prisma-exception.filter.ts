import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ERROR_CODES } from '@tirapro/types';
import type { AuthedRequest } from '../types/request';

/** Map lỗi Prisma đã biết sang error envelope chuẩn. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthedRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL;
    let message = 'Lỗi cơ sở dữ liệu';

    switch (exception.code) {
      case 'P2002': {
        status = HttpStatus.CONFLICT;
        code = ERROR_CODES.CONFLICT;
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        message = `Giá trị đã tồn tại${target ? ` (${target})` : ''}`;
        break;
      }
      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        code = ERROR_CODES.NOT_FOUND;
        message = 'Bản ghi không tồn tại';
        break;
      case 'P2003':
        status = HttpStatus.CONFLICT;
        code = ERROR_CODES.CONFLICT;
        message = 'Vi phạm ràng buộc khóa ngoại';
        break;
      default:
        this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
    }

    res.status(status).json({
      success: false,
      error: { code, message, statusCode: status },
      meta: { requestId: req.id, timestamp: new Date().toISOString(), path: req.url },
    });
  }
}
