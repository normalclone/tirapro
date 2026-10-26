import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId } from '@paralleldrive/cuid2';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import {
  OBJECT_STORAGE,
  deleteBestEffort,
  getOrNull,
  putOrThrowBusiness,
  type ObjectStorage,
} from '../../common/storage/object-storage';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertIssueWritable } from '../../common/project-writable';

/** Cấu hình lưu trữ (mirror config.storage) — ở đây chỉ cần giới hạn kích thước. */
interface StorageConfig {
  maxFileSizeMb?: number;
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
  stream: Readable;
  fileName: string;
  mimeType: string;
  /** Kích thước thật trong kho lưu trữ (nếu biết) → Content-Length. */
  size?: number;
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  private readonly maxFileSizeMb: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {
    this.maxFileSizeMb = config.get<StorageConfig>('storage')?.maxFileSizeMb ?? 25;
  }

  /** Tải tệp đính kèm cho một issue (chỉ trong workspace). */
  async upload(
    workspaceId: string,
    userId: string,
    issueId: string,
    file: Express.Multer.File | undefined,
  ): Promise<AttachmentDto> {
    await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    if (!file) throw new BusinessRuleException('Thiếu file');

    const maxBytes = this.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BusinessRuleException(`Tệp vượt quá kích thước tối đa ${this.maxFileSizeMb}MB`);
    }

    const { storageKey, checksum } = await this.writeFile(workspaceId, file);

    let row;
    try {
      row = await this.prisma.attachment.create({
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
    } catch (err) {
      await deleteBestEffort(this.logger, this.storage, storageKey); // không để object mồ côi
      throw err;
    }
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
    const obj = await getOrNull(this.logger, this.storage, att.storageKey);
    if (!obj) throw new NotFoundAppException('Tệp');
    return {
      stream: obj.stream,
      fileName: att.fileName,
      mimeType: att.mimeType,
      size: obj.size,
    };
  }

  /** Xóa tệp đính kèm + best-effort xóa object (lỗi xoá object chỉ được log, không chặn người dùng). */
  async remove(workspaceId: string, id: string): Promise<{ ok: true }> {
    const att = await this.requireScoped(workspaceId, id);
    if (att.issueId) await assertIssueWritable(this.prisma, att.issueId);
    await this.prisma.attachment.delete({ where: { id: att.id } });
    // Không ném lại để tránh dữ liệu mồ côi trong DB sau khi đã xóa row.
    await deleteBestEffort(this.logger, this.storage, att.storageKey);
    return { ok: true };
  }

  /** Ghi buffer vào kho lưu trữ. Trả storageKey (`{workspaceId}/{cuid}-{tên}`) + checksum sha256. */
  private async writeFile(
    workspaceId: string,
    file: Express.Multer.File,
  ): Promise<{ storageKey: string; checksum: string }> {
    const storageKey = `${workspaceId}/${createId()}-${this.sanitizeName(file.originalname)}`;
    const { checksum } = await putOrThrowBusiness(
      this.logger,
      this.storage,
      storageKey,
      file.buffer,
      {
        contentType: file.mimetype,
        size: file.buffer.length,
      },
    );
    return { storageKey, checksum };
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
    if (!issue) throw new NotFoundAppException('Công việc');
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
