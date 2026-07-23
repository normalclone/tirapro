import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId } from '@paralleldrive/cuid2';
import { promises as fs, createReadStream, type ReadStream } from 'node:fs';
import * as path from 'node:path';
import type { Request } from 'express';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';

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
 * Ảnh là dữ liệu công khai → serve qua route @Public, lưu cục bộ dưới {STORAGE_LOCAL_DIR}/avatars.
 * URL trả về là tuyệt đối (dựng từ request lúc upload) để nhúng trực tiếp bằng URL ảnh.
 */
@Injectable()
export class MediaService {
  private readonly localDir: string;
  private readonly urlPrefix: string; // ví dụ /api/v1

  constructor(config: ConfigService) {
    this.localDir = config.get<string>('storage.localDir') ?? './uploads';
    const gp = config.get<string>('api.globalPrefix') ?? 'api';
    const v = config.get<string>('api.version') ?? 'v1';
    this.urlPrefix = `/${gp}/${v}`;
  }

  private dir(): string {
    return path.join(this.localDir, 'avatars');
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
    await fs.mkdir(this.dir(), { recursive: true });
    await fs.writeFile(path.join(this.dir(), fileName), file.buffer);
    return this.publicUrl(fileName, req);
  }

  private publicUrl(fileName: string, req: Request): string {
    const host = req.get('host');
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] || req.protocol;
    return `${proto}://${host}${this.urlPrefix}/media/avatars/${fileName}`;
  }

  /** Stream ảnh cho route công khai (chống path traversal). */
  async serve(fileRaw: string): Promise<{ stream: ReadStream; mimeType: string }> {
    const file = path.basename(fileRaw);
    if (!/^[\w.-]+$/.test(file)) throw new NotFoundAppException('Ảnh');
    const ext = file.split('.').pop()?.toLowerCase() ?? '';
    const abs = path.join(this.dir(), file);
    try {
      await fs.access(abs);
    } catch {
      throw new NotFoundAppException('Ảnh');
    }
    return { stream: createReadStream(abs), mimeType: EXT_TO_MIME[ext] ?? 'application/octet-stream' };
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
    if (!/^[\w.-]+$/.test(file)) return;
    try {
      await fs.unlink(path.join(this.dir(), file));
    } catch {
      /* best-effort: file có thể đã bị xoá */
    }
  }
}
