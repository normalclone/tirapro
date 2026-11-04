import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { DOMAIN_EVENTS } from '@tirapro/types';
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

/** Số việc đã đổi điểm và số Epic đã đổi tổng sau một lần `recomputeAll`. */
export interface RecomputeResult {
  updated: number;
  epics: number;
}

/** Số việc đọc/ghi mỗi lô khi tính lại (theo từng dự án, phân trang theo id). */
const RECOMPUTE_BATCH = 500;
/** Số Epic cộng lại mỗi transaction. */
const EPIC_ROLLUP_BATCH = 100;

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

  /** Đang chạy `recomputeAll` (một lần tại một thời điểm; lưu liên tiếp thì chạy lại đúng một lần sau lần đang chạy). */
  private recomputing: Promise<RecomputeResult> | null = null;
  private recomputeAgain = false;

  constructor(
    private readonly prisma: PrismaService,
    // Tuỳ chọn để spec dựng bằng một đối số vẫn chạy; Nest DI tiêm bản thật. Chỉ dùng để báo client nạp lại sau `recomputeAll`.
    private readonly events?: EventEmitter2,
  ) {}

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
   * Chạy TRONG transaction của bên gọi; khoá từng Epic theo thứ tự id để không deadlock giữa các lô.
   */
  async rollupEpics(tx: Prisma.TransactionClient, epicIds: string[]): Promise<string[]> {
    const changed: string[] = [];
    for (const id of [...new Set(epicIds)].filter(Boolean).sort()) {
      // Khoá dòng Epic (FOR UPDATE, như khoá cột WIP): hai transaction cùng đổi việc con của một Epic xếp hàng, transaction sau
      // cộng lại SAU khi transaction trước commit nên không ghi đè bằng tổng thiếu việc con của nhau.
      await tx.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${id} FOR UPDATE`;
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
  /**
   * Tính lại điểm TOÀN HỆ THỐNG theo bảng hệ số hiện hành (SA vừa lưu, hoặc sau migration) — chạy nền, không chặn request.
   * - Theo từng dự án, lô 500 việc (phân trang theo id); chỉ động vào việc KHÔNG chỉnh tay, KHÔNG phải Epic và có điểm
   *   khác công thức; mỗi việc đổi được tăng `version` (OCC đúng). Không ghi lịch sử hoạt động từng việc.
   * - Sau cùng cộng lại điểm MỌI Epic từ việc con (cùng `rollupEpics` như luồng sửa việc).
   * - Báo client mở dự án nạp lại bằng `PROJECT_RANKS_REBALANCED` (cùng nghĩa: version/giá trị của cả dự án đã đổi). Không
   *   phát `ISSUE_UPDATED` từng việc: sẽ kích hoạt thông báo/tự động hoá/Telegram cho thay đổi do hệ thống.
   * Gọi đồng thời: lần gọi sau không chạy song song mà đặt cờ chạy lại MỘT lần khi lần đang chạy xong (bảng hệ số có thể
   * đã đổi giữa chừng) và trả về chính lần chạy đó.
   */
  recomputeAll(): Promise<RecomputeResult> {
    if (this.recomputing) {
      this.recomputeAgain = true;
      return this.recomputing;
    }
    const run = (async () => {
      const total: RecomputeResult = { updated: 0, epics: 0 };
      do {
        this.recomputeAgain = false;
        const r = await this.recomputeOnce();
        total.updated += r.updated;
        total.epics += r.epics;
      } while (this.recomputeAgain);
      return total;
    })().finally(() => {
      this.recomputing = null;
    });
    this.recomputing = run;
    return run;
  }

  private async recomputeOnce(): Promise<RecomputeResult> {
    // Bảng hệ số đọc MỚI (bỏ cache): người gọi vừa ghi xong hoặc script/deploy vừa đổi.
    this.cache = null;
    const formula = await this.getFormula();
    const [types, priorities, projects] = await Promise.all([
      this.prisma.issueType.findMany({ select: { id: true, key: true } }),
      this.prisma.priority.findMany({ select: { id: true, name: true } }),
      // allow-deleted: mọi dự án (kể cả đã xoá mềm/lưu trữ) — điểm phải khớp công thức khi dự án được khôi phục
      this.prisma.project.findMany({ select: { id: true } }),
    ]);
    const typeKey = new Map(types.map((t) => [t.id, t.key]));
    const priorityName = new Map(priorities.map((p) => [p.id, p.name]));
    const touchedProjects = new Set<string>();
    let updated = 0;
    for (const { id: projectId } of projects) {
      let cursor: string | undefined;
      for (;;) {
        // allow-deleted: việc đã xoá mềm cũng phải đúng điểm để khôi phục về không lệch (tổng Epic vẫn loại việc đã xoá)
        const rows = await this.prisma.issue.findMany({
          where: { projectId, pointsManual: false, NOT: { type: { key: 'EPIC' } } },
          select: { id: true, typeId: true, difficulty: true, priorityId: true, storyPoints: true },
          orderBy: { id: 'asc' },
          take: RECOMPUTE_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) break;
        cursor = rows[rows.length - 1]!.id;
        // Gom theo điểm mới: một câu UPDATE cho mỗi giá trị (vài giá trị) thay vì mỗi việc một câu.
        const byValue = new Map<number, string[]>();
        for (const r of rows) {
          const pts = computePoints(
            formula,
            typeKey.get(r.typeId) ?? null,
            r.difficulty,
            r.priorityId ? (priorityName.get(r.priorityId) ?? null) : null,
          );
          if (pts === null || pts === r.storyPoints) continue;
          byValue.set(pts, [...(byValue.get(pts) ?? []), r.id]);
        }
        for (const [pts, ids] of byValue) {
          // `pointsManual: false` lặp lại ở where: người dùng vừa chỉnh tay giữa chừng thì không bị ghi đè.
          const { count } = await this.prisma.issue.updateMany({
            where: { id: { in: ids }, pointsManual: false },
            data: { storyPoints: pts, version: { increment: 1 } },
          });
          updated += count;
          if (count > 0) touchedProjects.add(projectId);
        }
        if (rows.length < RECOMPUTE_BATCH) break;
      }
    }
    const epics = await this.rollupAllEpics(touchedProjects);
    if (this.events)
      for (const projectId of touchedProjects)
        this.events.emit(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED, { projectId });
    return { updated, epics };
  }

  /** Cộng lại điểm MỌI Epic chưa xoá (theo lô, mỗi lô một transaction); thêm dự án có Epic đổi vào `touched`. */
  private async rollupAllEpics(touched: Set<string>): Promise<number> {
    const epicRows = await this.prisma.issue.findMany({
      where: { deletedAt: null, type: { key: 'EPIC' } },
      select: { id: true, projectId: true },
      orderBy: { id: 'asc' },
    });
    const projectOf = new Map(epicRows.map((e) => [e.id, e.projectId]));
    let changed = 0;
    for (let i = 0; i < epicRows.length; i += EPIC_ROLLUP_BATCH) {
      const ids = epicRows.slice(i, i + EPIC_ROLLUP_BATCH).map((e) => e.id);
      const done = await this.prisma.$transaction((tx) => this.rollupEpics(tx, ids));
      changed += done.length;
      for (const id of done) touched.add(projectOf.get(id)!);
    }
    return changed;
  }
}
