import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditAction, AuditLogDto } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { cursorPage, type PageResult } from '../../common/dto/page-result';

export interface AuditEntry {
  workspaceId?: string | null;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** Câu tiếng Việt dựng sẵn ("Thêm Bình (ba@x.vn) với vai trò Thành viên"). */
  summary: string;
  /** Số liệu thô (roleIds, tên vai trò…). KHÔNG đưa mật khẩu/token/config tích hợp vào đây. */
  meta?: Record<string, unknown>;
}

export interface AuditListQuery {
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

/** Ghi + đọc nhật ký kiểm toán quản trị (bảng AuditLog, tách khỏi ActivityLog của công việc). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi một sự kiện. Không truyền `tx`: ghi sau khi thao tác đã commit và NUỐT lỗi (log warn) —
   * sự kiện quản trị đã xong không được vỡ vì ghi nhật ký. Truyền `tx`: ghi cùng transaction, lỗi lan ra.
   */
  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const data = {
      workspaceId: entry.workspaceId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      meta: (entry.meta ?? {}) as Prisma.InputJsonValue,
    };
    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }
    try {
      await this.prisma.auditLog.create({ data });
    } catch (e) {
      this.logger.warn(
        `Không ghi được nhật ký quản trị (${entry.action}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Nhật ký của một workspace, mới nhất trước, phân trang con trỏ (id dòng cuối, keyset [createdAt, id]). */
  async list(workspaceId: string, q: AuditListQuery): Promise<PageResult<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = { workspaceId };
    if (q.action) where.action = q.action;
    if (q.actorId) where.actorId = q.actorId;
    if (q.from || q.to) {
      where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    if (q.cursor) {
      const cur = await this.prisma.auditLog.findFirst({
        where: { id: q.cursor, workspaceId },
        select: { createdAt: true },
      });
      // Con trỏ không tồn tại (đã xoá, hoặc của workspace khác): báo lỗi rõ — KHÔNG lặng lẽ trả lại trang đầu
      // (client sẽ nối trang đầu vào danh sách đang xem và lặp mãi).
      if (!cur)
        throw new BusinessRuleException('Con trỏ phân trang không hợp lệ — hãy tải lại trang');
      where.AND = [
        {
          OR: [
            { createdAt: { lt: cur.createdAt } },
            { createdAt: cur.createdAt, id: { lt: q.cursor } },
          ],
        },
      ];
    }
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const actors = await this.resolveActors(rows.map((r) => r.actorId));
    return cursorPage(
      rows.map((r) => this.toDto(r, actors)),
      q.limit,
      (i) => i.id,
    );
  }

  /** Tên + avatar người thực hiện, tra theo lô (actorId không phải FK nên không `include` được). */
  async resolveActors(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = unique.length
      ? await this.prisma.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, displayName: true, avatarUrl: true },
        })
      : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  toDto(
    r: {
      id: string;
      actorId: string | null;
      action: string;
      entityType: string;
      entityId: string | null;
      summary: string;
      meta: Prisma.JsonValue;
      createdAt: Date;
    },
    actors: Map<string, { id: string; displayName: string; avatarUrl: string | null }>,
  ): AuditLogDto {
    return {
      id: r.id,
      action: r.action as AuditAction,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      meta: (r.meta ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
      actor: r.actorId ? (actors.get(r.actorId) ?? null) : null,
    };
  }
}
