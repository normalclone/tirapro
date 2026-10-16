import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { withCronLock } from '../../common/cron-lock';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { periodRange } from './goal-pace';
import { KrMeasureService, type MeasurableKr } from './kr-measure.service';

/** Ngày UTC (00:00) của `d` — khớp cột `@db.Date`. */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Còn đáng chụp không: kỳ quý `YYYY-Qn` — đang trong kỳ hoặc ≤ 7 ngày sau kỳ (đủ thời gian chốt số cuối);
 * kỳ tự do — luôn chụp khi mục tiêu ACTIVE.
 */
function periodIsLive(period: string, today: Date): boolean {
  const range = periodRange(period);
  if (!range) return true;
  const day = today.getTime();
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  return day >= start && day <= end + GRACE_DAYS * DAY_MS;
}

type SnapshotKr = MeasurableKr & { currentValue: number };

/**
 * Chụp giá trị Key Result hằng ngày (L29) để vẽ đường tiến độ — KR tự đo ghi số đo, KR nhập tay lặp `currentValue`
 * (đường liền, không phải nội suy). Chạy 01:30 UTC (lệch 85 phút so với snapshot sprint để khỏi dồn tải).
 *
 * Đúng đắn do unique `(keyResultId, snapshotDate)` + `createMany skipDuplicates` (chạy lại cùng ngày, hai node
 * đồng thời, khởi động lại giữa chừng đều không sinh bản trùng) — khoá Redis chỉ để đỡ tốn công đo.
 * Ngữ cảnh hệ thống: đo theo phạm vi `'public'` (không có người xem) nên lịch sử không lộ số dự án riêng tư.
 */
@Injectable()
export class KrSnapshotCron implements OnApplicationShutdown {
  private readonly logger = new Logger(KrSnapshotCron.name);
  /** Bật khi app tắt: vòng chụp dừng sớm. */
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly measurer: KrMeasureService,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  @Cron('30 1 * * *', { timeZone: 'UTC' })
  async runDaily(): Promise<void> {
    await withCronLock(this.redis, 'goals:kr-snapshot', 1800, async () => {
      await this.snapshotAll();
    }).catch((err: Error) => this.logger.warn(`Chụp Key Result hằng ngày lỗi: ${err.message}`));
  }

  /** Chụp mọi KR của mục tiêu ACTIVE ở mọi workspace. Trả số dòng đã ghi. Mỗi workspace bọc try/catch riêng. */
  async snapshotAll(now: Date = new Date()): Promise<number> {
    if (this.stopping) return 0;
    const snapshotDate = utcDay(now);
    const workspaces = await this.prisma.workspace.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let written = 0;
    for (const ws of workspaces) {
      if (this.stopping) break;
      try {
        written += await this.snapshotWorkspace(ws.id, snapshotDate);
      } catch (err) {
        this.logger.warn(`Chụp KR workspace ${ws.id} lỗi: ${(err as Error).message}`);
      }
    }
    return written;
  }

  private async snapshotWorkspace(workspaceId: string, snapshotDate: Date): Promise<number> {
    const objectives = await this.prisma.objective.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        // Mục tiêu gắn dự án đã xoá/lưu trữ bị bỏ qua (cấp workspace thì luôn xét).
        OR: [{ projectId: null }, { project: { deletedAt: null, archivedAt: null } }],
        keyResults: { some: {} },
      },
      select: {
        id: true,
        period: true,
        keyResults: { select: { id: true, source: true, sourceConfig: true, currentValue: true } },
      },
    });
    const krs: SnapshotKr[] = objectives
      .filter((o) => periodIsLive(o.period, snapshotDate))
      .flatMap((o) => o.keyResults);
    if (krs.length === 0) return 0;

    // KR đã có bản chụp hôm nay: khỏi đo lại.
    const done = new Set(
      (
        await this.prisma.keyResultCheckIn.findMany({
          where: { keyResultId: { in: krs.map((k) => k.id) }, snapshotDate },
          select: { keyResultId: true },
        })
      ).map((r) => r.keyResultId),
    );
    const todo = krs.filter((k) => !done.has(k.id));
    if (todo.length === 0) return 0;

    const measured = await this.measurer.measure(
      workspaceId,
      'public',
      todo.filter((k) => k.source !== 'MANUAL'),
    );
    const data: Prisma.KeyResultCheckInCreateManyInput[] = [];
    for (const k of todo) {
      const value = k.source === 'MANUAL' ? k.currentValue : (measured.get(k.id)?.value ?? null);
      if (value === null) {
        // Đo lỗi (vd JQL cũ dùng currentUser/me, dự án đã xoá): không ghi số bịa; KR khác vẫn chụp bình thường.
        this.logger.warn(`Bỏ qua chụp KR ${k.id}: ${measured.get(k.id)?.error ?? 'không đo được'}`);
        continue;
      }
      data.push({ keyResultId: k.id, value, source: 'AUTO', snapshotDate });
    }
    if (data.length === 0) return 0;
    const res = await this.prisma.keyResultCheckIn.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /**
   * Chụp ngay MỘT KR (gọi sau khi tạo/đổi nguồn KR tự đo để điểm xuất phát có sẵn): ghi đè bản chụp hôm nay nếu đã có
   * (đổi nguồn giữa ngày thì số cũ không còn đúng). Bỏ qua im lặng nếu mục tiêu không ACTIVE/dự án đã xoá-lưu trữ.
   */
  async snapshotKeyResult(keyResultId: string, now: Date = new Date()): Promise<void> {
    const snapshotDate = utcDay(now);
    const kr = await this.prisma.keyResult.findFirst({
      where: { id: keyResultId },
      select: {
        id: true,
        source: true,
        sourceConfig: true,
        currentValue: true,
        objective: {
          select: {
            workspaceId: true,
            status: true,
            project: { select: { deletedAt: true, archivedAt: true } },
          },
        },
      },
    });
    if (!kr || kr.objective.status !== 'ACTIVE') return;
    const project = kr.objective.project;
    if (project && (project.deletedAt || project.archivedAt)) return;

    let value: number | null = kr.currentValue;
    if (kr.source !== 'MANUAL') {
      const res = (await this.measurer.measure(kr.objective.workspaceId, 'public', [kr])).get(
        kr.id,
      );
      value = res?.value ?? null;
    }
    if (value === null) return;
    await this.prisma.keyResultCheckIn.upsert({
      where: { keyResultId_snapshotDate: { keyResultId: kr.id, snapshotDate } },
      create: { keyResultId: kr.id, value, source: 'AUTO', snapshotDate },
      update: { value },
    });
  }
}
