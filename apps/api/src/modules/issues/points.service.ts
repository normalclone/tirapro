import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_POINTS_FORMULA,
  computePoints,
  explainPoints,
  pointsFormulaSchema,
  type Difficulty,
  type PointsFormula,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Bảng hệ số đọc lại từ DB sau chừng này ms (nhiều instance API: bản SA vừa lưu ở máy khác sẽ tới trong ≤ TTL). */
const FORMULA_TTL_MS = 30_000;

/** Đầu vào công thức của một việc. */
export interface PointsInput {
  typeId: string;
  difficulty: Difficulty;
  priorityId: string | null;
}

/** Hàng issue đã nạp `type`/`priority` (issueInclude) — đủ để giải thích điểm mà không truy vấn thêm. */
export interface PointsExplainRow {
  difficulty: Difficulty;
  type: { key: string | null; name: string };
  priority: { name: string } | null;
}

/**
 * Điểm việc = Điểm gốc theo Loại × Hệ số Độ khó × Hệ số Ưu tiên (công thức ở `@tirapro/shared`, bảng hệ số toàn hệ thống
 * ở `PointsFormulaConfig`, chỉ SA sửa). Epic: điểm = tổng điểm việc con (`rollupEpics`), không áp công thức.
 */
@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);
  private cache: { formula: PointsFormula; at: number } | null = null;
  private lastTry = 0;
  private inflight: Promise<PointsFormula> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Nạp sẵn bảng hệ số lúc khởi động để `explain` (đồng bộ) không rơi về mặc định ngay yêu cầu đầu tiên. */
  async onModuleInit(): Promise<void> {
    try {
      await this.getFormula();
    } catch (e) {
      this.logger.warn(
        `Chưa nạp được bảng hệ số điểm — dùng mặc định tạm: ${(e as Error).message}`,
      );
    }
  }

  /** Bảng hệ số hiện hành (cache trong bộ nhớ, hết hạn sau TTL, `setFormula` làm mới ngay). */
  async getFormula(): Promise<PointsFormula> {
    const c = this.cache;
    if (c && Date.now() - c.at < FORMULA_TTL_MS) return c.formula;
    // Gộp các lần đọc đồng thời thành một truy vấn.
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<PointsFormula> {
    this.lastTry = Date.now();
    const row = await this.prisma.pointsFormulaConfig.findUnique({ where: { id: 'default' } });
    let formula = DEFAULT_POINTS_FORMULA;
    if (row) {
      const parsed = pointsFormulaSchema.safeParse(row.formula);
      if (parsed.success) formula = parsed.data;
      else this.logger.error('PointsFormulaConfig.formula không hợp lệ — dùng bảng mặc định');
    }
    this.cache = { formula, at: Date.now() };
    return formula;
  }

  /**
   * Bảng hệ số cho nơi ĐỒNG BỘ (`toDto`): trả bản đã cache (hoặc mặc định khi chưa nạp) và làm mới nền khi hết hạn.
   * Chỉ dùng để GIẢI THÍCH điểm — mọi phép ghi điểm đều đi qua `getFormula()`.
   */
  peekFormula(): PointsFormula {
    const c = this.cache;
    if ((!c || Date.now() - c.at >= FORMULA_TTL_MS) && Date.now() - this.lastTry >= FORMULA_TTL_MS)
      this.getFormula().catch(() => undefined);
    return c?.formula ?? DEFAULT_POINTS_FORMULA;
  }

  /** Ghi bảng hệ số mới (SA) rồi làm mới cache. Validate ở nơi gọi (controller dùng `pointsFormulaSchema`). */
  async setFormula(formula: PointsFormula, updatedById: string | null): Promise<PointsFormula> {
    const value = pointsFormulaSchema.parse(formula);
    await this.prisma.pointsFormulaConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', formula: value, updatedById },
      update: { formula: value, updatedById },
    });
    this.cache = { formula: value, at: Date.now() };
    return value;
  }

  /** Tên ưu tiên + khoá loại → điểm; `null` cho Epic. Truy vấn qua `tx` để thấy dữ liệu chưa commit (import). */
  async pointsFor(tx: Prisma.TransactionClient, issue: PointsInput): Promise<number | null> {
    const [formula, type, priority] = await Promise.all([
      this.getFormula(),
      tx.issueType.findUnique({ where: { id: issue.typeId }, select: { key: true } }),
      issue.priorityId
        ? tx.priority.findUnique({ where: { id: issue.priorityId }, select: { name: true } })
        : Promise.resolve(null),
    ]);
    return computePoints(formula, type?.key ?? null, issue.difficulty, priority?.name ?? null);
  }

  /** Giải thích điểm theo bảng hiện hành (đồng bộ, dùng cho DTO). */
  explain(row: PointsExplainRow, manual = false): string {
    const text = explainPoints(
      this.peekFormula(),
      row.type.key,
      row.type.name,
      row.difficulty,
      row.priority?.name ?? null,
    );
    return manual ? `Đã chỉnh tay (theo công thức: ${text})` : text;
  }

  /** Tổng `storyPoints` của việc chưa xoá có `epicId` = epic (kể cả sub-task; mỗi việc cộng một lần). */
  async epicTotal(tx: Prisma.TransactionClient, epicId: string): Promise<number> {
    const sum = await tx.issue.aggregate({
      where: { epicId, deletedAt: null },
      _sum: { storyPoints: true },
    });
    return sum._sum.storyPoints ?? 0;
  }

  /**
   * Đặt điểm mỗi Epic = tổng `storyPoints` của việc chưa xoá có `epicId` đó (kể cả sub-task); chỉ ghi khi tổng đổi, và khi
   * ghi thì tăng `version` (OCC đúng). Trả về id các Epic đã đổi để bên gọi phát sự kiện realtime SAU commit.
   * Chạy TRONG transaction của bên gọi.
   */
  async rollupEpics(tx: Prisma.TransactionClient, epicIds: string[]): Promise<string[]> {
    const changed: string[] = [];
    for (const id of [...new Set(epicIds)].filter(Boolean).sort()) {
      const epic = await tx.issue.findFirst({
        where: { id, deletedAt: null },
        select: { storyPoints: true },
      });
      if (!epic) continue; // Epic đã xoá/không còn: không có gì để cập nhật
      const total = await this.epicTotal(tx, id);
      if (epic.storyPoints === total) continue;
      await tx.issue.updateMany({
        where: { id, deletedAt: null },
        data: { storyPoints: total, version: { increment: 1 } },
      });
      changed.push(id);
    }
    return changed;
  }
}
