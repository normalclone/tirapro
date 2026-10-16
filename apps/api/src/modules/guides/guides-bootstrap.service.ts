import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_GUIDES, type GuideSeed } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Nạp hướng dẫn mặc định (Guide toàn cục, `workspaceId = null`) lúc khởi động API — idempotent, mọi workspace (mới và cũ)
 * thấy ngay. Nội dung ở `DEFAULT_GUIDES` (code, sửa qua review), không bằng migration SQL.
 *
 * - Một transaction + `pg_advisory_xact_lock`: nhiều node khởi động cùng lúc không chèn trùng (không có unique index vì
 *   Postgres coi NULL là khác nhau trong `@@unique([workspaceId, key])`).
 * - So khớp theo (workspaceId null, key); cập nhật khi `version` trong code > version trong DB, bỏ qua nếu bằng/thấp hơn
 *   (không hạ cấp bản mới hơn).
 * - Lỗi chỉ log cảnh báo — API vẫn chạy (degrade gracefully).
 */
@Injectable()
export class GuidesBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GuidesBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureDefaults();
    } catch (err) {
      this.logger.warn(
        `Không nạp được hướng dẫn mặc định: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async ensureDefaults(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tirapro-guides-bootstrap'))`;
      for (const g of DEFAULT_GUIDES) {
        const cur = await tx.guide.findFirst({
          where: { workspaceId: null, key: g.key },
          select: { id: true, version: true },
        });
        if (!cur) {
          await tx.guide.create({ data: { workspaceId: null, key: g.key, ...fields(g) } });
        } else if (cur.version < g.version) {
          await tx.guide.update({ where: { id: cur.id }, data: fields(g) });
        }
      }
    });
  }
}

function fields(g: GuideSeed) {
  return {
    type: g.type,
    screen: g.screen,
    title: g.title,
    description: g.description,
    content: g.content as unknown as Prisma.InputJsonValue,
    audience: [] as string[],
    isPublished: true,
    version: g.version,
    order: g.order,
  };
}
