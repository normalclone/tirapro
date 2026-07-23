import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId } from '@paralleldrive/cuid2';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { ReadStream } from 'node:fs';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';

/** Cấu hình lưu trữ (mirror config.storage). */
interface StorageConfig {
  driver: 'local' | 's3';
  localDir: string;
  maxFileSizeMb: number;
}

/** DTO trả về cho client — không lộ storageKey. */
export interface AttachmentDto {
  id: string;
  issueId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadedById: string | null;
  createdAt: string;
}

/** Tệp đã sẵn sàng để stream về client. */
export interface AttachmentDownload {
  stream: ReadStream;
  fileName: string;
  mimeType: string;
}

@Injectable()
export class AttachmentsService {
  private readonly storage: StorageConfig;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const s = config.get<StorageConfig>('storage');
    this.storage = {
      driver: s?.driver ?? 'local',
      localDir: s?.localDir ?? './uploads',
      maxFileSizeMb: s?.maxFileSizeMb ?? 25,
    };
  }

  /** Tải tệp đính kèm cho một issue (chỉ trong workspace). */
  async upload(
    workspaceId: string,
    userId: string,
    issueId: string,
    file: Express.Multer.File | undefined,
  ): Promise<AttachmentDto> {
    await this.requireIssue(workspaceId, issueId);
    if (!file) throw new BusinessRuleException('Thiếu file');

    const maxBytes = this.storage.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BusinessRuleException(
        `Tệp vượt quá kích thước tối đa ${this.storage.maxFileSizeMb}MB`,
      );
    }

    const { storageKey, checksum } = await this.writeFile(workspaceId, file);

    const row = await this.prisma.attachment.create({
      data: {
        issueId,
        uploadedById: userId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        checksum,
      },
    });
    return this.toDto(row);
  }

  /** Danh sách tệp đính kèm của issue, mới nhất trước. */
  async list(workspaceId: string, issueId: string): Promise<AttachmentDto[]> {
    await this.requireIssue(workspaceId, issueId);
    const rows = await this.prisma.attachment.findMany({
      where: { issueId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /** Chuẩn bị stream tải xuống (kiểm tra scope qua issue.workspaceId). */
  async download(workspaceId: string, id: string): Promise<AttachmentDownload> {
    const att = await this.requireScoped(workspaceId, id);
    const absPath = this.absPath(att.storageKey);
    try {
      await fs.access(absPath);
    } catch {
      throw new NotFoundAppException('Tệp');
    }
    return {
      stream: createReadStream(absPath),
      fileName: att.fileName,
      mimeType: att.mimeType,
    };
  }

  /** Xóa tệp đính kèm + best-effort xóa file trên đĩa. */
  async remove(workspaceId: string, id: string): Promise<{ ok: true }> {
    const att = await this.requireScoped(workspaceId, id);
    await this.prisma.attachment.delete({ where: { id: att.id } });
    try {
      await fs.unlink(this.absPath(att.storageKey));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        // Bỏ qua lỗi xóa file (best-effort); chỉ chặn nếu không phải file-not-found.
        // Không ném lại để tránh dữ liệu mồ côi trong DB sau khi đã xóa row.
      }
    }
    return { ok: true };
  }

  /** Ghi buffer xuống đĩa (driver local). Trả storageKey + checksum sha256. */
  private async writeFile(
    workspaceId: string,
    file: Express.Multer.File,
  ): Promise<{ storageKey: string; checksum: string }> {
    if (this.storage.driver === 's3') {
      throw new BusinessRuleException('S3 chưa hỗ trợ');
    }

    const base = this.storage.localDir;
    const safeName = this.sanitizeName(file.originalname);
    const storageKey = `${workspaceId}/${createId()}-${safeName}`;
    const absPath = path.join(base, storageKey);

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.buffer);

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    return { storageKey, checksum };
  }

  /** Đường dẫn tuyệt đối tới file trong thư mục lưu trữ. */
  private absPath(storageKey: string): string {
    return path.join(this.storage.localDir, storageKey);
  }

  /** Bỏ ký tự phân tách đường dẫn, giữ phần đuôi file; chống path traversal. */
  private sanitizeName(name: string): string {
    const base = path.basename(name).replace(/[\\/]/g, '');
    const cleaned = base.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '');
    return cleaned.length ? cleaned : 'file';
  }

  /** Issue phải thuộc workspace và chưa xóa mềm. */
  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }

  /** Attachment phải có issue thuộc workspace hiện tại. */
  private async requireScoped(workspaceId: string, id: string) {
    const att = await this.prisma.attachment.findFirst({
      where: { id, issue: { workspaceId } },
    });
    if (!att) throw new NotFoundAppException('Tệp đính kèm');
    return att;
  }

  private toDto(row: {
    id: string;
    issueId: string | null;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string | null;
    uploadedById: string | null;
    createdAt: Date;
  }): AttachmentDto {
    return {
      id: row.id,
      issueId: row.issueId,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      checksum: row.checksum,
      uploadedById: row.uploadedById,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
