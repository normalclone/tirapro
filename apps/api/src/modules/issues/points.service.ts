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

/** Số việc đã đổi điểm (công thức + việc cha cộng lại) và số Epic đã đổi tổng sau một lần `recomputeAll`. */
export interface RecomputeResult {
  updated: number;
  epics: number;
}

/** Một việc cần ghi điểm mới (kèm đầu vào đã đọc, để ghi có điều kiện). */
interface PointsChange {
  id: string;
  typeId: string;
  difficulty: Difficulty;
  priorityId: string | null;
  pts: number;
}

/** Kết quả cộng lại một việc cha: có đổi không, cha và Epic của nó (để đi tiếp lên cây). */
interface ParentRollup {
  changed: boolean;
  parentId: string | null;
  epicId: string | null;
}

/** Số việc đọc/ghi mỗi lô khi tính lại (theo từng dự án, phân trang theo id). */
const RECOMPUTE_BATCH = 500;
/** Số Epic / việc cha cộng lại mỗi transaction. */
const EPIC_ROLLUP_BATCH = 100;
/** Độ sâu tối đa khi cộng ngược lên chuỗi việc cha (cây không có vòng; chặn để chắc chắn dừng). */
const MAX_PARENT_DEPTH = 20;

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
 * ở `PointsFormulaConfig`, chỉ SA sửa). Hai trường hợp KHÔNG áp công thức:
 *  - việc cha (không phải Epic) đang có ≥1 việc con chưa xoá: điểm = tổng điểm việc con (`rollupParents`);
 *  - Epic: điểm = tổng điểm các việc CẤP TRÊN thuộc Epic (`parentId` rỗng; điểm việc cha đã gồm việc con của nó) (`rollupEpics`).
 * Thứ tự khoá/cộng luôn là việc con → việc cha → Epic.
 */
@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);
  private cache: { formula: PointsFormula; at: number } | null = null;
  private lastTry = 0;
  /** Tăng mỗi lần `setFormula`; lần đọc DB bắt đầu ở thế hệ cũ không được ghi cache. */
  private generation = 0;
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
    if (!this.inflight) {
      const p: Promise<PointsFormula> = this.load().finally(() => {
        // Chỉ gỡ chính lần đọc này (`setFormula` có thể đã thay bằng lần đọc mới hơn).
        if (this.inflight === p) this.inflight = null;
      });
      this.inflight = p;
    }
    return this.inflight;
  }

  /**
   * Đọc bảng hệ số từ DB. Lần đọc BẮT ĐẦU trước khi `setFormula` ghi (đọc ra bản cũ) không được ghi đè cache sau đó:
   * so `generation` lúc vào với lúc xong.
   */
  private async load(): Promise<PointsFormula> {
    this.lastTry = Date.now();
    const generation = this.generation;
    const row = await this.prisma.pointsFormulaConfig.findUnique({ where: { id: 'default' } });
    let formula = DEFAULT_POINTS_FORMULA;
    if (row) {
      const parsed = pointsFormulaSchema.safeParse(row.formula);
      if (parsed.success) formula = parsed.data;
      else this.logger.error('PointsFormulaConfig.formula không hợp lệ — dùng bảng mặc định');
    }
    if (generation === this.generation) this.cache = { formula, at: Date.now() };
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
    // Mọi lần đọc đang bay (có thể đọc ra bản cũ) hết hiệu lực: không dùng lại, không ghi đè cache.
    this.generation++;
    this.inflight = null;
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

  /**
   * Tổng `storyPoints` của việc chưa xoá thuộc Epic ở CẤP TRÊN: không có cha hoặc cha đã xoá mềm. Việc con (sub-task) của
   * cha còn sống đã nằm trong điểm của cha nên không cộng lần nữa.
   */
  async epicTotal(tx: Prisma.TransactionClient, epicId: string): Promise<number> {
    const sum = await tx.issue.aggregate({
      where: {
        epicId,
        deletedAt: null,
        // Việc cấp trên của Epic: không có cha, hoặc cha đã xoá mềm (việc con mồ côi không còn nằm trong điểm cha nào).
        OR: [{ parentId: null }, { parent: { deletedAt: { not: null } } }],
      },
      _sum: { storyPoints: true },
    });
    return sum._sum.storyPoints ?? 0;
  }

  /**
   * Đặt điểm mỗi Epic = tổng `storyPoints` của việc chưa xoá cấp trên (không cha / cha đã xoá) có `epicId` đó; chỉ ghi khi tổng đổi, và khi
   * ghi thì tăng `version` (OCC đúng). Trả về id các Epic đã đổi để bên gọi phát sự kiện realtime SAU commit.
   * Chạy TRONG transaction của bên gọi; khoá từng Epic theo thứ tự id để không deadlock giữa các lô.
   */
  async rollupEpics(
    tx: Prisma.TransactionClient,
    epicIds: string[],
    /** `keepUpdatedAt`: tính lại hàng loạt của HỆ THỐNG (recomputeAll) không đổi `updatedAt`; sửa việc của người dùng thì có. */
    opts: { keepUpdatedAt?: boolean } = {},
  ): Promise<string[]> {
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
      if (opts.keepUpdatedAt)
        await tx.$executeRaw`UPDATE "Issue" SET "storyPoints" = ${total}::float8, "version" = "version" + 1 WHERE "id" = ${id} AND "deletedAt" IS NULL`;
      else
        await tx.issue.updateMany({
          where: { id, deletedAt: null },
          data: { storyPoints: total, version: { increment: 1 } },
        });
      changed.push(id);
    }
    return changed;
  }

  /**
   * Cộng điểm các việc CHA: việc cha (không phải Epic) đang có ≥1 việc con chưa xoá → `storyPoints` = tổng điểm việc con
   * và bỏ cờ `pointsManual` (thành cha thuần: không áp công thức, không chỉnh tay); hết việc con → tính lại theo công thức
   * trừ khi `pointsManual`. Chỉ ghi khi giá trị (hoặc cờ) đổi, và khi ghi thì tăng `version` (OCC đúng). Khoá dòng
   * (FOR UPDATE) như `rollupEpics`; chạy TRONG transaction của bên gọi.
   * THỨ TỰ KHOÁ luôn là việc con → cha → ông → Epic (cho mọi bên gọi, kể cả khi truyền cả cha lẫn ông): một id đứng một
   * mình thì đi lên chuỗi theo từng cha vừa đổi; nhiều id thì nạp trước chuỗi tổ tiên rồi xử lý từ tầng sâu nhất lên
   * (cùng tầng theo id), tổ tiên chỉ bị xử lý khi có việc dưới nó vừa đổi.
   * Trả về id các Epic có việc cha vừa đổi — bên gọi nối tiếp bằng `rollupEpics`. `opts.changed` (tuỳ chọn) nhận
   * id các việc cha đã đổi, để phát sự kiện realtime sau commit.
   */
  async rollupParents(
    tx: Prisma.TransactionClient,
    parentIds: string[],
    opts: { keepUpdatedAt?: boolean; changed?: string[] } = {},
  ): Promise<string[]> {
    const ids = [...new Set(parentIds)].filter(Boolean);
    const epics = new Set<string>();
    const note = (id: string, r: ParentRollup | null): string | null => {
      if (!r?.changed) return null;
      opts.changed?.push(id);
      if (r.epicId) epics.add(r.epicId);
      return r.parentId;
    };
    if (ids.length === 1) {
      // Một id: đi lên theo chuỗi cha — tự nhiên đúng thứ tự con → cha → ông.
      let cur: string | null = ids[0]!;
      for (let depth = 0; cur && depth < MAX_PARENT_DEPTH; depth++)
        cur = note(cur, await this.rollupOneParent(tx, cur, opts));
      return [...epics];
    }
    if (ids.length === 0) return [];
    const parentOf = await this.loadAncestors(tx, ids);
    const depthOf = (id: string): number => {
      let d = 0;
      for (let c = parentOf.get(id); c && d < MAX_PARENT_DEPTH; c = parentOf.get(c)) d++;
      return d;
    };
    const order = [...parentOf.keys()].sort((x, y) => depthOf(y) - depthOf(x) || (x < y ? -1 : 1));
    const dirty = new Set(ids);
    for (const id of order) {
      if (!dirty.has(id)) continue;
      const up = note(id, await this.rollupOneParent(tx, id, opts));
      if (up) dirty.add(up);
    }
    return [...epics];
  }

  /** Nạp `parentId` của các id và mọi tổ tiên của chúng (kể cả tổ tiên đã xoá mềm: chỉ để xếp thứ tự khoá). */
  private async loadAncestors(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<Map<string, string | null>> {
    const parentOf = new Map<string, string | null>();
    let frontier = ids;
    for (let i = 0; i < MAX_PARENT_DEPTH && frontier.length > 0; i++) {
      // allow-deleted: chỉ dựng cây tổ tiên để xếp thứ tự khoá, không đọc dữ liệu nghiệp vụ
      const rows = await tx.issue.findMany({
        where: { id: { in: frontier } },
        select: { id: true, parentId: true },
      });
      const next = new Set<string>();
      for (const r of rows) {
        parentOf.set(r.id, r.parentId);
        if (r.parentId && !parentOf.has(r.parentId)) next.add(r.parentId);
      }
      for (const id of frontier) if (!parentOf.has(id)) parentOf.set(id, null); // id không còn tồn tại
      frontier = [...next];
    }
    return parentOf;
  }

  /** Khoá và cộng lại MỘT việc cha; `null` khi bỏ qua (không có/đã xoá/Epic/hết việc con mà chỉnh tay). */
  private async rollupOneParent(
    tx: Prisma.TransactionClient,
    id: string,
    opts: { keepUpdatedAt?: boolean },
  ): Promise<ParentRollup | null> {
    await tx.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${id} FOR UPDATE`;
    const parent = await tx.issue.findFirst({
      where: { id, deletedAt: null },
      select: {
        storyPoints: true,
        pointsManual: true,
        typeId: true,
        difficulty: true,
        priorityId: true,
        parentId: true,
        epicId: true,
        type: { select: { key: true } },
      },
    });
    if (!parent || parent.type.key === 'EPIC') return null; // Epic có quy tắc riêng (`rollupEpics`)
    const children = await tx.issue.aggregate({
      where: { parentId: id, deletedAt: null },
      _sum: { storyPoints: true },
      _count: { _all: true },
    });
    const hasChildren = children._count._all > 0;
    let target: number | null;
    if (hasChildren) target = children._sum.storyPoints ?? 0;
    else if (parent.pointsManual)
      return null; // hết việc con: giữ điểm đã chỉnh tay
    else target = await this.pointsFor(tx, parent);
    // Có việc con => cha thuần: cờ chỉnh tay bị bỏ (kể cả khi tổng khớp sẵn).
    const clearManual = hasChildren && parent.pointsManual;
    const result = { changed: false, parentId: parent.parentId, epicId: parent.epicId };
    if (target === null || (parent.storyPoints === target && !clearManual)) return result;
    if (opts.keepUpdatedAt)
      await tx.$executeRaw`UPDATE "Issue" SET "storyPoints" = ${target}::float8, "pointsManual" = false, "version" = "version" + 1 WHERE "id" = ${id} AND "deletedAt" IS NULL`;
    else
      await tx.issue.updateMany({
        where: { id, deletedAt: null },
        data: { storyPoints: target, pointsManual: false, version: { increment: 1 } },
      });
    return { ...result, changed: true };
  }

  /**
   * Tính lại điểm TOÀN HỆ THỐNG theo bảng hệ số hiện hành (SA vừa lưu, hoặc sau migration) — chạy nền, không chặn request.
   * - Theo từng dự án, lô 500 việc (phân trang theo id); chỉ động vào việc KHÔNG chỉnh tay, KHÔNG phải Epic, KHÔNG có việc
   *   con chưa xoá (việc cha lấy tổng việc con) và có điểm khác công thức; mỗi việc đổi được tăng `version` (OCC đúng).
   *   Không ghi lịch sử hoạt động từng việc.
   * - Rồi cộng lại điểm MỌI việc cha (tầng thấp trước) từ việc con, rồi MỌI Epic từ việc cấp trên (cùng `rollupParents`/
   *   `rollupEpics` như luồng sửa việc). Cả hai bước không đổi `updatedAt`.
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
    // Bảng hệ số đọc MỚI từ DB, KHÔNG qua cache/lần đọc đang bay (có thể là bản cũ trước khi SA lưu).
    const formula = await this.load();
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
          // Việc cha (có việc con chưa xoá) lấy tổng điểm việc con ở bước cộng việc cha bên dưới, không theo công thức.
          where: {
            projectId,
            pointsManual: false,
            NOT: { type: { key: 'EPIC' } },
            children: { none: { deletedAt: null } },
          },
          select: { id: true, typeId: true, difficulty: true, priorityId: true, storyPoints: true },
          orderBy: { id: 'asc' },
          take: RECOMPUTE_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) break;
        cursor = rows[rows.length - 1]!.id;
        const changes: PointsChange[] = [];
        for (const r of rows) {
          const pts = computePoints(
            formula,
            typeKey.get(r.typeId) ?? null,
            r.difficulty,
            r.priorityId ? (priorityName.get(r.priorityId) ?? null) : null,
          );
          if (pts === null || pts === r.storyPoints) continue;
          changes.push({ ...r, pts });
        }
        const count = await this.writeComputedPoints(changes);
        updated += count;
        if (count > 0) touchedProjects.add(projectId);
        if (rows.length < RECOMPUTE_BATCH) break;
      }
    }
    updated += await this.rollupAllParents(touchedProjects);
    const epics = await this.rollupAllEpics(touchedProjects);
    if (this.events)
      for (const projectId of touchedProjects)
        this.events.emit(DOMAIN_EVENTS.PROJECT_RANKS_REBALANCED, { projectId });
    return { updated, epics };
  }

  /**
   * Ghi điểm đã tính cho MỘT lô bằng MỘT câu SQL thô — cố ý KHÔNG đổi `updatedAt` (đây là việc hệ thống tính lại, không phải
   * người dùng sửa; SLA/"cập nhật gần đây" dựa vào `updatedAt`), chỉ tăng `version` (OCC đúng).
   * WHERE lặp lại ĐẦU VÀO đã dùng để tính (loại, độ khó, ưu tiên) và `pointsManual = false`: nếu giữa lúc đọc và ghi người
   * dùng đã sửa một trong các trường đó (đường sửa của họ đã tự tính lại điểm) hoặc chỉnh tay, dòng đó không còn khớp và
   * bị bỏ qua thay vì bị ghi đè bằng giá trị cũ. Trả số dòng thật sự ghi.
   */
  private async writeComputedPoints(changes: PointsChange[]): Promise<number> {
    if (changes.length === 0) return 0;
    const ids = changes.map((c) => c.id);
    const typeIds = changes.map((c) => c.typeId);
    const difficulties = changes.map((c) => c.difficulty);
    // Ưu tiên rỗng mã hoá '' (mảng tham số không mang NULL chắc chắn qua mọi driver); so với COALESCE(priorityId, '').
    const priorityIds = changes.map((c) => c.priorityId ?? '');
    const pts = changes.map((c) => c.pts);
    return this.prisma.$executeRaw`
      UPDATE "Issue" AS i
      SET "storyPoints" = v.pts, "version" = i."version" + 1
      FROM unnest(${ids}::text[], ${typeIds}::text[], ${difficulties}::text[], ${priorityIds}::text[], ${pts}::float8[])
        AS v(id, type_id, difficulty, priority_id, pts)
      WHERE i."id" = v.id
        AND NOT i."pointsManual"
        AND i."typeId" = v.type_id
        AND i."difficulty"::text = v.difficulty
        AND COALESCE(i."priorityId", '') = v.priority_id`;
  }

  /**
   * Cộng lại điểm MỌI việc cha chưa xoá (có việc con chưa xoá, không phải Epic), tầng thấp trước (cha của việc lá trước, rồi
   * ông…). `rollupParents` còn cộng ngược lên chuỗi nên kết quả đúng kể cả khi một lô chứa cả cha lẫn ông. Trả số việc cha
   * đã đổi; thêm dự án của chúng vào `touched`.
   */
  private async rollupAllParents(touched: Set<string>): Promise<number> {
    const rows = await this.prisma.issue.findMany({
      where: {
        deletedAt: null,
        children: { some: { deletedAt: null } },
        NOT: { type: { key: 'EPIC' } },
      },
      select: { id: true, projectId: true, parentId: true },
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) return 0;
    const projectOf = new Map(rows.map((r) => [r.id, r.projectId]));
    const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
    // Độ sâu trong tập việc cha: cha không có cha nào khác trong tập = 0. Mỗi lô chỉ chứa việc CÙNG độ sâu, sâu nhất trước
    // (con → cha → ông), để thứ tự khoá không đảo dù `rollupParents` sắp lại id trong lô.
    const depthOf = (id: string): number => {
      let d = 0;
      for (
        let cur = parentOf.get(id);
        cur && parentOf.has(cur) && d < MAX_PARENT_DEPTH;
        cur = parentOf.get(cur)
      )
        d++;
      return d;
    };
    const byDepth = new Map<number, string[]>();
    for (const r of rows) {
      const d = depthOf(r.id);
      byDepth.set(d, [...(byDepth.get(d) ?? []), r.id]);
    }
    const batches: string[][] = [];
    for (const d of [...byDepth.keys()].sort((x, y) => y - x))
      for (let i = 0; i < byDepth.get(d)!.length; i += EPIC_ROLLUP_BATCH)
        batches.push(byDepth.get(d)!.slice(i, i + EPIC_ROLLUP_BATCH));
    const changed = new Set<string>(); // một việc cha có thể đổi ở lô sau do chuỗi cộng ngược: đếm một lần
    for (const ids of batches) {
      const done: string[] = [];
      await this.prisma.$transaction((tx) =>
        this.rollupParents(tx, ids, { keepUpdatedAt: true, changed: done }),
      );
      for (const id of done) {
        changed.add(id);
        const pid = projectOf.get(id);
        if (pid) touched.add(pid);
      }
    }
    return changed.size;
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
      const done = await this.prisma.$transaction((tx) =>
        this.rollupEpics(tx, ids, { keepUpdatedAt: true }),
      );
      changed += done.length;
      for (const id of done) touched.add(projectOf.get(id)!);
    }
    return changed;
  }
}
