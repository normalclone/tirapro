import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { withCronLock } from '../../common/cron-lock';
import { SprintsService } from './sprints.service';

/** Cuối ngày UTC (23:59:59.999) của ngày chứa `d`. */
export function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/**
 * Chụp snapshot DAILY cho mọi sprint ACTIVE (mọi workspace) để burndown không phải suy ngược từ lịch sử.
 *
 * Cron chạy 00:05 nên chụp ĐÚNG trạng thái cuối ngày hôm qua; snapshot được đóng dấu `snapshotAt` = 23:59:59.999 UTC
 * của ngày vừa qua ("trạng thái cuối ngày D") để burndown ghép theo ngày không bị lệch một ngày.
 * Idempotent: chạy lại (hoặc hai node) không ghi trùng vì đã có snapshot DAILY của ngày đó.
 */
@Injectable()
export class SprintSnapshotCron {
  private readonly logger = new Logger(SprintSnapshotCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sprints: SprintsService,
  ) {}

  @Cron('5 0 * * *')
  async runDaily(): Promise<void> {
    // Khoá Redis để nhiều node API không chụp trùng.
    await withCronLock(this.redis, 'sprint-daily', 600, async () => {
      await this.snapshotActiveSprints();
    }).catch((err: Error) =>
      this.logger.warn(`Snapshot sprint hằng ngày lỗi: ${err.message}`),
    );
  }

  /** Trả số snapshot đã ghi. Mỗi sprint bọc try/catch riêng — một sprint lỗi không chặn các sprint khác. */
  async snapshotActiveSprints(now: Date = new Date()): Promise<number> {
    // Ngày được chụp = ngày UTC ngay trước `now`.
    const dayEnd = endOfUtcDay(new Date(now.getTime() - 24 * 3_600_000));
    const dayStart = new Date(Date.UTC(dayEnd.getUTCFullYear(), dayEnd.getUTCMonth(), dayEnd.getUTCDate()));
    const active = await this.prisma.sprint.findMany({
      where: { state: 'ACTIVE', deletedAt: null, project: { deletedAt: null } },
      select: { id: true, startDate: true },
    });
    let written = 0;
    for (const sprint of active) {
      try {
        // Sprint bắt đầu SAU ngày được chụp (vd start lúc 00:03) thì chưa có "cuối ngày" nào để ghi.
        if (sprint.startDate && sprint.startDate > dayEnd) continue;
        const existing = await this.prisma.sprintSnapshot.findFirst({
          where: { sprintId: sprint.id, kind: 'DAILY', snapshotAt: { gte: dayStart, lte: dayEnd } },
          select: { id: true },
        });
        if (existing) continue;
        await this.prisma.$transaction((tx) => this.sprints.snapshot(tx, sprint.id, 'DAILY', dayEnd));
        written++;
      } catch (err) {
        this.logger.warn(`Snapshot DAILY sprint ${sprint.id} lỗi: ${(err as Error).message}`);
      }
    }
    return written;
  }
}
