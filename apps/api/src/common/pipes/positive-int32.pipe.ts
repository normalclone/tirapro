import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { ERROR_CODES } from '@tirapro/types';
import { AppException } from '../exceptions/app.exception';

/** Tham số đường dẫn là số nguyên 1..2^31-1 (vừa cột Int của Postgres); ngoài khoảng → 400 thay vì 500 từ Prisma. */
@Injectable()
export class PositiveInt32Pipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const n = /^\d{1,10}$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 2_147_483_647) {
      throw new AppException(
        ERROR_CODES.VALIDATION_ERROR,
        'Số phiên bản không hợp lệ',
        HttpStatus.BAD_REQUEST,
      );
    }
    return n;
  }
}
