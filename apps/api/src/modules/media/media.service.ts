import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId } from '@paralleldrive/cuid2';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import type { Request } from 'express';
import {
  OBJECT_STORAGE,
  deleteBestEffort,
  getOrNull,
  putOrThrowBusiness,
  type ObjectStorage,
} from '../../common/storage/object-storage';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';

/** MIME ảnh được phép → đuôi file chuẩn hoá. SVG bị loại (tránh rủi ro nội dung script). */
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Lưu/serve ảnh đại diện (avatar/logo) cho user, workspace, project.
 * Ảnh là dữ liệu công khai → serve qua route @Public (stream qua API), lưu qua ObjectStorage với khoá `avatars/<file>`
 * (local: {STORAGE_LOCAL_DIR}/avatars; s3: object cùng khoá trong bucket).
 * URL trả về là tuyệt đối (dựng từ request lúc upload) để nhúng trực tiếp bằng URL ảnh.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly urlPrefix: string; // ví dụ /api/v1

  constructor(
    config: ConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {
    const gp = config.get<string>('api.globalPrefix') ?? 'api';
    const v = config.get<string>('api.version') ?? 'v1';
    this.urlPrefix = `/${gp}/${v}`;
  }

  /** Ghi ảnh xuống đĩa, trả về URL tuyệt đối để lưu vào avatarUrl. */
  async saveAvatar(
    file: Express.Multer.File | undefined,
    scope: string,
    req: Request,
  ): Promise<string> {
    if (!file) throw new BusinessRuleException('Thiếu file ảnh');
    const ext = ALLOWED[file.mimetype];
    if (!ext) throw new BusinessRuleException('Chỉ chấp nhận ảnh PNG, JPG, WEBP hoặc GIF');
    if (file.size > MAX_AVATAR_BYTES) throw new BusinessRuleException('Ảnh vượt quá 5MB');

    const fileName = `${scope}-${createId()}.${ext}`;
    await putOrThrowBusiness(this.logger, this.storage, `avatars/${fileName}`, file.buffer, {
      contentType: file.mimetype,
      size: file.buffer.length,
    });
    return this.publicUrl(fileName, req);
  }

  private publicUrl(fileName: string, req: Request): string {
    const host = req.get('host');
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] || req.protocol;
    return `${proto}://${host}${this.urlPrefix}/media/avatars/${fileName}`;
  }

  /** Stream ảnh cho route công khai (chống path traversal). */
  async serve(fileRaw: string): Promise<{ stream: Readable; mimeType: string; size?: number }> {
    const file = path.basename(fileRaw);
    // `.`/`..` khớp regex tên nhưng là khoá không hợp lệ: từ chối sạch (400), không chạm storage, không log lỗi.
    if (/^\.+$/.test(file)) throw new BadRequestException('Tên ảnh không hợp lệ');
    if (!/^[\w.-]+$/.test(file)) throw new NotFoundAppException('Ảnh');
    const ext = file.split('.').pop()?.toLowerCase() ?? '';
    const obj = await getOrNull(this.logger, this.storage, `avatars/${file}`);
    if (!obj) throw new NotFoundAppException('Ảnh');
    return {
      stream: obj.stream,
      mimeType: EXT_TO_MIME[ext] ?? 'application/octet-stream',
      size: obj.size,
    };
  }

  /**
   * Xoá file avatar cũ theo URL (best-effort). Chỉ xoá nếu URL trỏ tới media của ta;
   * URL ngoài (vd dicebear seed) được bỏ qua an toàn.
   */
  async removeByUrl(url?: string | null): Promise<void> {
    if (!url) return;
    const marker = `${this.urlPrefix}/media/avatars/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const file = path.basename(url.slice(idx + marker.length));
    if (!/^[\w.-]+$/.test(file) || /^\.+$/.test(file)) return;
    await deleteBestEffort(this.logger, this.storage, `avatars/${file}`);
  }
}
