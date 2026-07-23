import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ERROR_CODES } from '@tirapro/types';
import { AppException } from '../exceptions/app.exception';

/**
 * Validate body/query bằng zod schema dùng chung (@tirapro/shared) — DRY contract FE↔BE.
 * Dùng: `@Body(new ZodValidationPipe(createIssueSchema)) dto: CreateIssueInput`.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        code: i.code.toUpperCase(),
        message: i.message,
      }));
      throw new AppException(
        ERROR_CODES.VALIDATION_ERROR,
        'Dữ liệu không hợp lệ',
        HttpStatus.BAD_REQUEST,
        details,
      );
    }
    return result.data;
  }
}
