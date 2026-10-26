import {
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { BusinessRuleException } from '../exceptions/app.exception';

/** Ảnh đại diện luôn giới hạn 5MB (khớp MediaService). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Interceptor nhận tệp multipart `file` với `limits.fileSize` đặt ở multer (M5): multer đệm cả tệp vào RAM, nên phải cắt
 * NGAY khi vượt giới hạn thay vì đợi kiểm `file.size` sau khi đã nạp xong. Vượt giới hạn → lỗi nghiệp vụ tiếng Việt (422)
 * giống thông điệp cũ. `attachment` lấy `MAX_FILE_SIZE_MB`; `avatar` cố định 5MB.
 */
export function makeUploadInterceptor(kind: 'attachment' | 'avatar'): Type<NestInterceptor> {
  @Injectable()
  class UploadInterceptor implements NestInterceptor {
    private readonly inner: NestInterceptor;
    private readonly message: string;

    constructor(config: ConfigService) {
      const mb = config.get<number>('storage.maxFileSizeMb') ?? 25;
      const maxBytes = kind === 'avatar' ? MAX_AVATAR_BYTES : mb * 1024 * 1024;
      this.message =
        kind === 'avatar' ? 'Ảnh vượt quá 5MB' : `Tệp vượt quá kích thước tối đa ${mb}MB`;
      const Multer = FileInterceptor('file', { limits: { fileSize: maxBytes } });
      this.inner = new Multer();
    }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      try {
        return await this.inner.intercept(context, next);
      } catch (err) {
        if (err instanceof PayloadTooLargeException) throw new BusinessRuleException(this.message);
        throw err;
      }
    }
  }
  return UploadInterceptor;
}

/** Dùng trực tiếp trong `@UseInterceptors(...)` (Nest tự dựng và tiêm ConfigService). */
export const AttachmentUploadInterceptor = makeUploadInterceptor('attachment');
export const AvatarUploadInterceptor = makeUploadInterceptor('avatar');
