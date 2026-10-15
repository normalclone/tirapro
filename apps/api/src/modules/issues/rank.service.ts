import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { DOMAIN_EVENTS, ERROR_CODES } from '@tirapro/types';
import { initialRanks, rankBetween, RankGapError } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  AppException,
  BusinessRuleException,
  RankNeighborsStaleException,
} from '../../common/exceptions/app.exception';

/** Thứ tự hai mốc đã đảo (prev > next nghiêm ngặt, sau khi bỏ số 0 đuôi) ⇒ client giữ mốc cũ, KHÔNG phải cạn chỗ. */
const neighborsInverted = (prev: string | null, next: string | null): boolean =>
  prev !== null && next !== null && prev.replace(/0+$/, '') > next.replace(/0+$/, '');

/** Tính rank (LexoRank) cho issue và đánh số lại cả project khi hết chỗ chèn. Tách từ IssuesService, không đổi hành vi. */
@Injectable()
export class RankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Rank của issue làm mốc — phải còn sống và cùng workspace/project, nếu không thì báo lỗi thay vì lặng lẽ xếp xuống cuối. */
  async rankOf(workspaceId: string, projectId: string, id: string): Promise<string> {
    const r = await this.prisma.issue.findFirst({
      where: { id, workspaceId, projectId, deletedAt: null },
      select: { rank: true },
    });
    if (!r)
      throw new AppException(
        ERROR_CODES.NOT_FOUND,
        'Công việc làm mốc không tồn tại — hãy tải lại trang',
        HttpStatus.NOT_FOUND,
      );
    return r.rank;
  }

  /**
   * Tính rank mới. Hai mốc đã đảo thứ tự (client giữ mốc cũ) thì 409 RANK_NEIGHBORS_STALE để client nạp lại,
   * KHÔNG rebalance. Hết chỗ chèn (RankGapError) thì đánh số lại cả project rồi đọc lại
   * hai mốc và tính lại đúng 1 lần.
   */
  async resolveRank(
    projectId: string,
    db: Prisma.TransactionClient,
    deferred: Array<() => void> | null,
    movedId: string | null,
    read: () => Promise<{ prev: string | null; next: string | null }>,
  ): Promise<string> {
    const first = await read();
    if (neighborsInverted(first.prev, first.next)) throw new RankNeighborsStaleException();
    try {
      return rankBetween(first.prev, first.next);
    } catch (e) {
      if (!(e instanceof RankGapError)) throw e;
    }
    await this.rebalanceProject(projectId, db, deferred, movedId);
    const again = await read();
    if (neighborsInverted(again.prev, again.next)) throw new RankNeighborsStaleException();
    try {
      return rankBetween(again.prev, again.next);
    } catch (e) {
      if (!(e instanceof RankGapError)) throw e;
      throw new BusinessRuleException(
        'Không xác định được vị trí thả — hãy tải lại trang rồi thử kéo thả lại',
      );
    }
  }

  /**
   * Đánh số lại rank toàn bộ issue của project (khi hết chỗ chèn). Khoá project bằng update để tuần tự hoá,
   * rồi ghi MỘT câu UPDATE cho cả project (không update từng dòng — tránh vượt timeout transaction).
   * `version` của các dòng (trừ issue đang kéo) được tăng để client đang giữ bản cũ bị OCC chặn thay vì ghi đè rank mới.
   * Sự kiện PROJECT_RANKS_REBALANCED chỉ phát sau khi commit: ngay khi tự mở transaction, hoặc chạy qua
   * `deferred` khi đang nằm trong transaction của bên gọi.
   */
  private async rebalanceProject(
    projectId: string,
    db: Prisma.TransactionClient,
    deferred: Array<() => void> | null,
    movedId: string | null,
  ): Promise<void> {
    const body = async (tx: Prisma.TransactionClient) => {
      await tx.project.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
        select: { id: true },
      });
      // allow-deleted: đánh lại rank cho mọi issue của dự án kể cả đã xoá mềm để thứ tự không trùng khi khôi phục
      const rows = await tx.issue.findMany({
        where: { projectId },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (!rows.length) return;
      const ids = rows.map((r) => r.id);
      const ranks = initialRanks(rows.length);
      // Issue đang được kéo (movedId) KHÔNG tăng version ở đây: updateWithVersion của chính thao tác kéo sẽ tăng,
      // và nó phải còn khớp version client gửi lên. updatedAt cập nhật tay vì @updatedAt của Prisma chỉ chạy phía client.
      await tx.$executeRaw`
        UPDATE "Issue" AS i
        SET "rank" = v.rank,
            "version" = i."version" + CASE WHEN i."id" = ${movedId}::text THEN 0 ELSE 1 END,
            "updatedAt" = now()
        FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${ranks}::text[]) AS rank) AS v
        WHERE i."id" = v.id`;
    };
    const notify = () => this.events.emit(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED, { projectId });
    // Đang trong transaction của bên gọi (import) thì chạy thẳng trong đó; không thì tự mở transaction riêng.
    if (db === (this.prisma as Prisma.TransactionClient)) {
      await this.prisma.$transaction(body, { timeout: 30_000 });
      notify();
    } else {
      await body(db);
      if (deferred) deferred.push(notify);
      else notify();
    }
  }
}
