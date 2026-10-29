import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type KeyResultSource, type ObjectiveStatus } from '@prisma/client';
import { ZodError } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { assertNotArchived } from '../../common/project-writable';
import { PERMISSIONS } from '@tirapro/types';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacService } from '../rbac/rbac.service';
import { expectedProgress, periodRange } from './goal-pace';
import { krProgress } from './kr-progress';
import { vnTodayUtc } from '@tirapro/shared';
import { KrSnapshotCron, vnDay } from './kr-snapshot.cron';
import { KrMeasureService, type MeasureResult } from './kr-measure.service';
import {
  parseSourceConfig,
  type CreateCheckInInput,
  type CreateGoalInput,
  type CreateKeyResultInput,
  type KeyResultUpsertInput,
  type UpdateGoalInput,
  type UpdateKeyResultInput,
} from './goals.schemas';

const OWNER_SELECT = { id: true, displayName: true, email: true, avatarUrl: true } as const;

/** `visible` = điều kiện hiển thị dự án của người xem (`{}` = thấy hết): việc gắn kèm thuộc dự án ẩn không hiện/không tính tiến độ. */
const objectiveSelect = (visible: Prisma.ProjectWhereInput) =>
  ({
    id: true,
    workspaceId: true,
    projectId: true,
    name: true,
    description: true,
    period: true,
    status: true,
    ownerId: true,
    createdAt: true,
    updatedAt: true,
    owner: { select: OWNER_SELECT },
    project: { select: { id: true, key: true, name: true } },
    keyResults: {
      orderBy: { createdAt: 'asc' as const },
      select: {
        id: true,
        name: true,
        unit: true,
        startValue: true,
        targetValue: true,
        currentValue: true,
        source: true,
        sourceConfig: true,
        unitLabel: true,
        // Chỉ check-in TAY (bản chụp AUTO hằng ngày của L29 không tính vào "Lịch sử (n)").
        _count: { select: { checkIns: { where: { source: 'MANUAL' as const } } } },
        checkIns: {
          where: { source: 'MANUAL' as const },
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { createdAt: true },
        },
      },
    },
    issues: {
      where: { issue: { deletedAt: null, project: { deletedAt: null, ...visible } } },
      select: {
        issue: {
          select: {
            id: true,
            key: true,
            summary: true,
            type: { select: { name: true, color: true } },
            status: { select: { name: true, category: true, color: true } },
          },
        },
      },
    },
  }) satisfies Prisma.ObjectiveSelect;

type ObjectiveRow = Prisma.ObjectiveGetPayload<{ select: ReturnType<typeof objectiveSelect> }>;

interface GoalListFilter {
  period?: string;
  projectId?: string;
  status?: string;
  ownerId?: string;
}

/** Kết quả đo + hàm quyết định có trả `sourceConfig` của KR cho người xem này không. */
interface DtoContext {
  measured: Map<string, MeasureResult>;
  canShowConfig: (kr: {
    source: KeyResultSource;
    sourceConfig: Prisma.JsonValue | null;
  }) => boolean;
}

type TxOp = (tx: Prisma.TransactionClient) => Promise<unknown>;

/** So hai giá trị JSON không phụ thuộc thứ tự khoá (cấu hình KR đã chuẩn hoá bằng zod). */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .map(([k, x]) => [k, norm(x)]),
        )
      : v;
  return JSON.stringify(norm(a ?? null)) === JSON.stringify(norm(b ?? null));
}

const DAY_MS = 86_400_000;
const DEFAULT_HISTORY_DAYS = 90;
const MAX_HISTORY_DAYS = 365;

/** Số ngày của cửa sổ lịch sử: `days` tường minh (kẹp [1,365]); không nêu → từ đầu quý (nếu có) hoặc 90 ngày. */
function clampHistoryDays(
  days: number | undefined,
  periodStart: string | undefined,
  today: Date,
): number {
  if (days !== undefined && Number.isFinite(days))
    return Math.min(MAX_HISTORY_DAYS, Math.max(1, Math.trunc(days)));
  if (periodStart) {
    const since =
      Math.floor((today.getTime() - Date.parse(`${periodStart}T00:00:00Z`)) / DAY_MS) + 1;
    if (since >= 1 && since <= MAX_HISTORY_DAYS) return since;
  }
  return DEFAULT_HISTORY_DAYS;
}

/**
 * MỤC TIÊU / OKR — Objective + KeyResult + issue gắn kèm.
 *
 * Tiến độ (`progress`) tính theo trung bình % của các Key Result:
 * `(current - start) / (target - start)`, kẹp trong [0,1]. Nếu mục tiêu có gắn
 * issue/epic thì kèm thêm `issueProgress` = % issue đã ở trạng thái DONE.
 * Mục tiêu chưa có KR nào thì lấy luôn `issueProgress` làm tiến độ chính.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly measurer: KrMeasureService,
    private readonly snapshots: KrSnapshotCron,
    private readonly rbac: RbacService,
  ) {}

  private readonly logger = new Logger(GoalsService.name);

  /**
   * Điều kiện hiển thị dự án của người xem (`{}` = thấy hết), tính MỘT lần mỗi lời gọi rồi truyền xuống các hàm con
   * (tránh tính lại chế độ quyền nhiều lần). `viewerId` bắt buộc ở mọi đường đọc.
   */
  private visibleFor(workspaceId: string, viewerId: string): Promise<Prisma.ProjectWhereInput> {
    return this.access.visibleWhere(viewerId, workspaceId);
  }

  /**
   * Điều kiện hiển thị mục tiêu: mục tiêu cấp tổ chức (không gắn dự án) luôn hiện; mục tiêu gắn dự án chỉ khi người xem
   * thấy dự án đó. `{}` khi không cần lọc (không viewer / admin). Dùng khoá `OR` cấp cao nhất.
   */
  private scopeOf(visible: Prisma.ProjectWhereInput): Prisma.ObjectiveWhereInput {
    return Object.keys(visible).length === 0
      ? {}
      : { OR: [{ projectId: null }, { project: visible }] };
  }

  async list(workspaceId: string, filter: GoalListFilter, viewerId: string) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    const where: Prisma.ObjectiveWhereInput = { workspaceId, ...this.scopeOf(visible) };
    if (filter.period) where.period = filter.period;
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.status) where.status = filter.status as ObjectiveStatus;
    if (filter.ownerId) where.ownerId = filter.ownerId;

    const rows = await this.prisma.objective.findMany({
      where,
      orderBy: [{ period: 'desc' }, { createdAt: 'asc' }],
      select: objectiveSelect(visible),
    });
    const ctx = await this.measureAll(workspaceId, viewerId, rows, visible);
    return rows.map((r) => this.toDto(r, ctx));
  }

  /** Các kỳ đã dùng (mới nhất trước) — để FE dựng bộ chọn kỳ mà không cần tải hết mục tiêu. */
  async periods(workspaceId: string, viewerId: string): Promise<string[]> {
    const visible = await this.visibleFor(workspaceId, viewerId);
    const rows = await this.prisma.objective.findMany({
      where: { workspaceId, ...this.scopeOf(visible) },
      distinct: ['period'],
      orderBy: { period: 'desc' },
      select: { period: true },
    });
    return rows.map((r) => r.period);
  }

  async get(workspaceId: string, id: string, viewerId: string) {
    return this.read(workspaceId, id, await this.visibleFor(workspaceId, viewerId), viewerId);
  }

  /** `viewerId` để đo KR tự đo theo dự án người xem thấy. */
  private async read(
    workspaceId: string,
    id: string,
    visible: Prisma.ProjectWhereInput,
    viewerId: string,
  ) {
    const row = await this.prisma.objective.findFirst({
      where: { id, workspaceId, ...this.scopeOf(visible) },
      select: objectiveSelect(visible),
    });
    if (!row) throw new NotFoundAppException('Mục tiêu');
    return this.toDto(row, await this.measureAll(workspaceId, viewerId, [row], visible));
  }

  /** Đo mọi KR tự đo của các mục tiêu trong MỘT lượt (KR cùng cấu hình đo một lần). Không có KR tự đo → không đo. */
  private async measureAll(
    workspaceId: string,
    viewerId: string,
    rows: ObjectiveRow[],
    visible: Prisma.ProjectWhereInput,
  ): Promise<DtoContext> {
    const auto = rows
      .flatMap((r) => r.keyResults)
      .filter((kr) => kr.source !== 'MANUAL')
      .map((kr) => ({ id: kr.id, source: kr.source, sourceConfig: kr.sourceConfig }));
    if (auto.length === 0) return { measured: new Map(), canShowConfig: () => true };
    const measured = await this.measurer.measure(workspaceId, { viewerId }, auto);

    // Che cấu hình (projectId của dự án riêng tư, JQL thô có thể chứa tên/khoá nhạy cảm) với người không đủ quyền:
    // số liệu vẫn tính theo quyền người xem, còn siêu dữ liệu chỉ trả khi thấy dự án đó / có GOAL_MANAGE (JQL).
    const needsProjects = auto.some(
      (k) => (k.sourceConfig as { projectId?: string } | null)?.projectId,
    );
    const needsManage = auto.some((k) => k.source === 'ISSUE_COUNT_JQL');
    const visibleIds = needsProjects
      ? await this.access.visibleProjectIds(viewerId, workspaceId, visible)
      : null;
    const canManage = needsManage
      ? (await this.rbac.getEffectivePermissions(viewerId, workspaceId)).has(
          PERMISSIONS.GOAL_MANAGE,
        )
      : false;
    const canShowConfig = (kr: {
      source: KeyResultSource;
      sourceConfig: Prisma.JsonValue | null;
    }) => {
      if (kr.source === 'MANUAL') return true;
      if (kr.source === 'ISSUE_COUNT_JQL') return canManage;
      const projectId = (kr.sourceConfig as { projectId?: string } | null)?.projectId;
      return !projectId || visibleIds === null || visibleIds.includes(projectId);
    };
    return { measured, canShowConfig };
  }

  async create(workspaceId: string, dto: CreateGoalInput, viewerId: string) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null, visible);
    const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
    const issueIds = dto.issueIds?.length
      ? await this.validateIssues(workspaceId, dto.issueIds, projectId, visible)
      : [];

    const krData = await Promise.all(
      (dto.keyResults ?? []).map(async (kr) =>
        this.krCreateData(kr, await this.resolveSource(workspaceId, viewerId, kr)),
      ),
    );

    const created = await this.prisma.objective.create({
      data: {
        workspaceId,
        projectId,
        ownerId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        period: dto.period.trim(),
        status: dto.status ?? 'ACTIVE',
        keyResults: { create: krData },
        issues: { create: issueIds.map((issueId) => ({ issueId })) },
      },
      select: { id: true },
    });
    if (krData.some((k) => k.source !== 'MANUAL')) await this.snapshotAutoOf(created.id);
    return this.read(workspaceId, created.id, visible, viewerId);
  }

  async update(workspaceId: string, id: string, dto: UpdateGoalInput, viewerId: string) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    const current = await this.requireObjective(workspaceId, id, visible);
    const data: Prisma.ObjectiveUpdateInput = {};

    if (dto.name !== undefined && dto.name !== null) {
      const name = dto.name.trim();
      if (!name) throw new ForbiddenAppException('Tên mục tiêu bắt buộc');
      data.name = name;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.period !== undefined && dto.period !== null) {
      const period = dto.period.trim();
      if (!period) throw new ForbiddenAppException('Kỳ bắt buộc');
      data.period = period;
    }
    if (dto.status !== undefined && dto.status !== null) data.status = dto.status;
    if (dto.projectId !== undefined) {
      const projectId = await this.resolveProject(workspaceId, dto.projectId ?? null, visible);
      data.project = projectId ? { connect: { id: projectId } } : { disconnect: true };
    }
    if (dto.ownerId !== undefined) {
      const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
      data.owner = ownerId ? { connect: { id: ownerId } } : { disconnect: true };
    }

    let anyAutoKr = false;
    // Mọi thao tác chạy trong MỘT transaction tương tác (đọc/ghi giá trị KR có điều kiện → previousValue đúng, OCC).
    const ops: TxOp[] = [(tx) => tx.objective.update({ where: { id }, data })];

    // Danh sách KR gửi lên = danh sách MỚI: có id → update, không id → create, thiếu → xoá.
    if (dto.keyResults !== undefined) {
      const existing = await this.prisma.keyResult.findMany({
        where: { objectiveId: id },
        select: { id: true, source: true, sourceConfig: true, currentValue: true },
      });
      const keptIds = new Set(dto.keyResults.map((kr) => kr.id).filter((v): v is string => !!v));
      const removed = existing.filter((kr) => !keptIds.has(kr.id)).map((kr) => kr.id);
      if (removed.length)
        ops.push((tx) =>
          tx.keyResult.deleteMany({ where: { id: { in: removed }, objectiveId: id } }),
        );
      for (const kr of dto.keyResults) {
        const prev = kr.id ? existing.find((e) => e.id === kr.id) : undefined;
        // KR cũ không gửi `source` → giữ nguồn hiện tại (không vô tình đưa KR tự đo về nhập tay).
        const src = await this.resolveSource(
          workspaceId,
          viewerId,
          kr.source === undefined && prev
            ? { source: prev.source, sourceConfig: prev.sourceConfig as Record<string, unknown> }
            : kr,
          prev,
        );
        if (src.source !== 'MANUAL') anyAutoKr = true;
        if (kr.id && prev) {
          const fields = this.krFields(kr, src);
          if (src.source === 'MANUAL') {
            // Không gửi `currentValue` → giữ giá trị hiện có (không vô tình đưa về điểm xuất phát).
            const value = kr.currentValue ?? prev.currentValue;
            if (value !== prev.currentValue) {
              // Form mở từ lâu: người khác vừa check-in → không ghi đè số mới bằng số cũ.
              if (
                kr.expectedCurrentValue !== undefined &&
                kr.expectedCurrentValue !== prev.currentValue
              )
                throw this.valueConflict(prev.currentValue);
              // Sửa số hiện tại ngay trong form cũng để lại dấu vết: cùng đường lịch sử với check-in.
              ops.push((tx) =>
                this.recordValueChange(
                  tx,
                  prev.id,
                  prev.currentValue,
                  value,
                  null,
                  viewerId,
                  fields,
                ),
              );
            } else {
              ops.push((tx) => tx.keyResult.update({ where: { id: prev.id }, data: fields }));
            }
          } else {
            // KR tự đo: `currentValue` trong DB (giá trị tay lần cuối) giữ nguyên, không bị ghi đè.
            ops.push((tx) => tx.keyResult.update({ where: { id: prev.id }, data: fields }));
          }
        } else {
          ops.push((tx) =>
            tx.keyResult.create({ data: { objectiveId: id, ...this.krCreateData(kr, src) } }),
          );
        }
      }
    }

    if (dto.issueIds !== undefined) {
      const projectId = dto.projectId !== undefined ? (dto.projectId ?? null) : current.projectId;
      const issueIds = dto.issueIds.length
        ? await this.validateIssues(workspaceId, dto.issueIds, projectId, visible)
        : [];
      // Chỉ thay phần việc thuộc dự án người sửa thấy; liên kết tới việc của dự án ẩn giữ nguyên (không xoá nhầm).
      ops.push((tx) =>
        tx.objectiveIssue.deleteMany({ where: { objectiveId: id, issue: { project: visible } } }),
      );
      if (issueIds.length) {
        ops.push((tx) =>
          tx.objectiveIssue.createMany({
            data: issueIds.map((issueId) => ({ objectiveId: id, issueId })),
          }),
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const op of ops) await op(tx);
    });
    if (anyAutoKr) await this.snapshotAutoOf(id);
    return this.read(workspaceId, id, visible, viewerId);
  }

  async remove(workspaceId: string, id: string, viewerId: string) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    await this.requireObjective(workspaceId, id, visible);
    await this.prisma.objective.delete({ where: { id } }); // KR + ObjectiveIssue cascade
    return { success: true };
  }

  // ───────────────────────── key results ─────────────────────────

  async addKeyResult(
    workspaceId: string,
    objectiveId: string,
    dto: CreateKeyResultInput,
    viewerId: string,
  ) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    await this.requireObjective(workspaceId, objectiveId, visible);
    const src = await this.resolveSource(workspaceId, viewerId, dto);
    const created = await this.prisma.keyResult.create({
      data: { objectiveId, ...this.krCreateData(dto, src) },
      select: { id: true },
    });
    // KR tự đo: chụp ngay một điểm để đường tiến độ có điểm xuất phát (không chờ cron 01:30).
    if (src.source !== 'MANUAL') await this.snapshotSafely(created.id);
    return this.read(workspaceId, objectiveId, visible, viewerId);
  }

  async updateKeyResult(
    workspaceId: string,
    objectiveId: string,
    keyResultId: string,
    dto: UpdateKeyResultInput,
    viewerId: string,
  ) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    await this.requireObjective(workspaceId, objectiveId, visible);
    const kr = await this.prisma.keyResult.findFirst({
      where: { id: keyResultId, objectiveId },
      select: { id: true, source: true, sourceConfig: true, currentValue: true },
    });
    if (!kr) throw new NotFoundAppException('Kết quả then chốt');

    const data: Prisma.KeyResultUpdateManyMutationInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new ForbiddenAppException('Tên kết quả then chốt bắt buộc');
      data.name = name;
    }
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.startValue !== undefined) data.startValue = dto.startValue;
    if (dto.targetValue !== undefined) data.targetValue = dto.targetValue;
    const source = dto.source ?? kr.source;
    if (dto.unitLabel !== undefined) data.unitLabel = dto.unitLabel?.trim() || null;
    const sourceTouched = dto.source !== undefined || dto.sourceConfig !== undefined;
    if (sourceTouched) {
      const src = await this.resolveSource(
        workspaceId,
        viewerId,
        {
          source,
          // Đổi nguồn mà không gửi cấu hình mới thì dùng cấu hình cũ (kiểm lại — có thể không khớp nguồn mới).
          sourceConfig:
            dto.sourceConfig !== undefined
              ? dto.sourceConfig
              : (kr.sourceConfig as Record<string, unknown> | null),
        },
        kr,
      );
      data.source = src.source;
      data.sourceConfig = src.sourceConfig;
    }

    // KR tự đo bỏ qua `currentValue` gửi lên (số đo tính lúc đọc). KR nhập tay: đổi số đi qua cùng đường
    // check-in (một dòng lịch sử + cập nhật có điều kiện trong một transaction) để lịch sử là nguồn sự thật duy nhất.
    const changed =
      dto.currentValue !== undefined && source === 'MANUAL' && dto.currentValue !== kr.currentValue;
    if (changed) {
      if (dto.expectedCurrentValue !== undefined && dto.expectedCurrentValue !== kr.currentValue)
        throw this.valueConflict(kr.currentValue);
      const value = dto.currentValue!;
      await this.prisma.$transaction((tx) =>
        this.recordValueChange(tx, keyResultId, kr.currentValue, value, null, viewerId, data),
      );
    } else {
      await this.prisma.keyResult.update({ where: { id: keyResultId }, data });
    }
    // Đổi nguồn/cấu hình sang tự đo: chụp lại điểm hôm nay theo cấu hình mới.
    if (sourceTouched && source !== 'MANUAL') await this.snapshotSafely(keyResultId);
    return this.read(workspaceId, objectiveId, visible, viewerId);
  }

  /**
   * Check-in tay: ghi một dòng lịch sử (`previousValue` = giá trị trước đó) và cập nhật `currentValue` trong MỘT
   * `$transaction`. Chỉ KR nhập tay — KR tự đo có số do hệ thống đo (lịch sử của chúng do cron chụp hằng ngày).
   */
  async addCheckIn(
    workspaceId: string,
    objectiveId: string,
    keyResultId: string,
    dto: CreateCheckInInput,
    viewerId: string,
  ) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    await this.requireObjective(workspaceId, objectiveId, visible);
    await this.prisma.$transaction(async (tx) => {
      // Đọc LẠI trong transaction: `previousValue` phải là số thật ngay trước khi ghi, không phải số lúc mở form.
      const kr = await tx.keyResult.findFirst({
        where: { id: keyResultId, objectiveId },
        select: { id: true, source: true, currentValue: true },
      });
      if (!kr) throw new NotFoundAppException('Kết quả then chốt');
      if (kr.source !== 'MANUAL')
        throw new BusinessRuleException('Kết quả này tự đo từ dữ liệu — không nhập tay');
      if (dto.expectedValue !== undefined && dto.expectedValue !== kr.currentValue)
        throw this.valueConflict(kr.currentValue);
      await this.recordValueChange(
        tx,
        keyResultId,
        kr.currentValue,
        dto.value,
        dto.note ?? null,
        viewerId,
      );
    });
    return this.read(workspaceId, objectiveId, visible, viewerId);
  }

  /** Lịch sử check-in của một KR, mới nhất trước. `limit` mặc định 30, kẹp [1, 50]. Đường đọc: không chặn dự án lưu trữ. */
  async listCheckIns(
    workspaceId: string,
    objectiveId: string,
    keyResultId: string,
    limit: number | undefined,
    viewerId: string,
  ) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    const objective = await this.prisma.objective.findFirst({
      where: { id: objectiveId, workspaceId, ...this.scopeOf(visible) },
      select: { id: true },
    });
    if (!objective) throw new NotFoundAppException('Mục tiêu');
    const kr = await this.prisma.keyResult.findFirst({
      where: { id: keyResultId, objectiveId },
      select: { id: true },
    });
    if (!kr) throw new NotFoundAppException('Kết quả then chốt');
    const rows = await this.prisma.keyResultCheckIn.findMany({
      where: { keyResultId, source: 'MANUAL' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(50, Math.max(1, Math.trunc(limit ?? 30))),
      select: {
        id: true,
        value: true,
        previousValue: true,
        note: true,
        createdAt: true,
        author: { select: { id: true, displayName: true } },
      },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** Chụp điểm hôm nay của một KR; lỗi chỉ ghi log — không bao giờ làm hỏng thao tác của người dùng. */
  private async snapshotSafely(keyResultId: string): Promise<void> {
    try {
      await this.snapshots.snapshotKeyResult(keyResultId);
    } catch (err) {
      this.logger.warn(`Chụp KR ${keyResultId} lỗi: ${(err as Error).message}`);
    }
  }

  private async snapshotAutoOf(objectiveId: string): Promise<void> {
    const ids = await this.prisma.keyResult.findMany({
      where: { objectiveId, source: { not: 'MANUAL' } },
      select: { id: true },
    });
    for (const { id } of ids) await this.snapshotSafely(id);
  }

  /**
   * Lịch sử tiến độ theo ngày của một mục tiêu (L29): mỗi KR một đường (check-in tay + bản chụp AUTO, điền bù ngày
   * thiếu bằng giá trị trước đó), đường trung bình mục tiêu và mốc kỳ vọng theo thời gian của quý.
   * Mặc định từ đầu kỳ (quý) hoặc 90 ngày; tối đa 365 ngày. Phạm vi xem: KR chỉ định một dự án mà người xem không
   * thấy → `points: []` + `scopeNote` (lịch sử của nguồn không chỉ định dự án đo trên dự án công khai).
   */
  async progressHistory(
    workspaceId: string,
    objectiveId: string,
    viewerId: string,
    days: number | undefined,
    now: Date = new Date(),
  ) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    const objective = await this.prisma.objective.findFirst({
      where: { id: objectiveId, workspaceId, ...this.scopeOf(visible) },
      select: {
        id: true,
        period: true,
        projectId: true,
        keyResults: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            unit: true,
            unitLabel: true,
            startValue: true,
            targetValue: true,
            source: true,
            sourceConfig: true,
          },
        },
      },
    });
    if (!objective) throw new NotFoundAppException('Mục tiêu');

    const today = vnDay(now);
    const range = periodRange(objective.period);
    const span = clampHistoryDays(days, range?.start, today);
    const fromDate = new Date(today.getTime() - (span - 1) * DAY_MS);

    // KR chỉ định dự án (nguồn tự đo) mà người xem không thấy → ẩn lịch sử.
    const hidden = new Set<string>();
    for (const kr of objective.keyResults) {
      const projectId =
        kr.source === 'MANUAL'
          ? undefined
          : (kr.sourceConfig as { projectId?: string } | null)?.projectId;
      if (projectId && !(await this.access.canSee(viewerId, workspaceId, projectId)))
        hidden.add(kr.id);
    }
    const shown = objective.keyResults.filter((kr) => !hidden.has(kr.id));

    // Lấy N dòng MỚI nhất (desc + take) rồi đảo lại thứ tự cũ → mới: nếu quá trần thì mất phần ĐẦU của đường, không mất phần cuối.
    const newestFirst = shown.length
      ? await this.prisma.keyResultCheckIn.findMany({
          where: {
            keyResultId: { in: shown.map((k) => k.id) },
            OR: [
              { snapshotDate: { gte: fromDate } },
              { snapshotDate: null, createdAt: { gte: fromDate } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 365 * shown.length,
          select: {
            keyResultId: true,
            value: true,
            source: true,
            snapshotDate: true,
            createdAt: true,
          },
        })
      : [];
    const rows = [...newestFirst].reverse();

    // Mỗi KR: ngày → {giá trị, tự động?}; dòng muộn hơn trong cùng ngày thắng (check-in tay sau bản chụp 01:30).
    type DayValue = { value: number; auto: boolean };
    const byKr = new Map<string, Map<string, DayValue>>();
    for (const r of rows) {
      // bản chụp: ngày lịch đã lưu; check-in tay: ngày VN của lúc tạo (không lệch một ngày lúc 00:00–07:00 VN)
      const day = (r.snapshotDate ?? vnTodayUtc(r.createdAt)).toISOString().slice(0, 10);
      const m = byKr.get(r.keyResultId) ?? new Map<string, DayValue>();
      m.set(day, { value: r.value, auto: r.source === 'AUTO' });
      byKr.set(r.keyResultId, m);
    }

    const toStr = today.toISOString().slice(0, 10);
    const sums = new Map<string, { total: number; n: number }>();
    const keyResults = objective.keyResults.map((kr) => {
      const base = {
        id: kr.id,
        name: kr.name,
        unit: kr.unit,
        unitLabel: kr.unitLabel,
        source: kr.source,
      };
      if (hidden.has(kr.id))
        return {
          ...base,
          points: [],
          scopeNote: 'Dự án riêng tư — bạn không có quyền xem lịch sử',
        };
      const own = byKr.get(kr.id);
      const points: Array<{ date: string; value: number; progress: number; auto: boolean }> = [];
      if (own && own.size) {
        const first = [...own.keys()].sort()[0]!;
        let last: { value: number; auto: boolean } | undefined;
        for (let t = Date.parse(`${first}T00:00:00Z`); t <= today.getTime(); t += DAY_MS) {
          const date = new Date(t).toISOString().slice(0, 10);
          last = own.get(date) ?? last;
          if (!last) continue;
          const progress = krProgress(kr.startValue, kr.targetValue, last.value);
          points.push({ date, value: last.value, progress, auto: last.auto });
          const acc = sums.get(date) ?? { total: 0, n: 0 };
          sums.set(date, { total: acc.total + progress, n: acc.n + 1 });
        }
      }
      return { ...base, points, scopeNote: null };
    });

    const objectiveLine = [...sums.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, { total, n }]) => ({ date, progress: Math.round(total / n) }));

    // Mốc kỳ vọng đi tiếp tới hết quý (đường KR dừng ở hôm nay) để thấy bám/trễ tiến độ so với phần thời gian còn lại.
    const expectedEnd = range ? Math.max(today.getTime(), Date.parse(`${range.end}T00:00:00Z`)) : 0;
    const expected = range
      ? Array.from(
          { length: Math.floor((expectedEnd - fromDate.getTime()) / DAY_MS) + 1 },
          (_, i) => {
            const d = new Date(fromDate.getTime() + i * DAY_MS);
            return {
              date: d.toISOString().slice(0, 10),
              progress: expectedProgress(objective.period, d)!,
            };
          },
        )
      : null;

    return {
      period: objective.period,
      from: fromDate.toISOString().slice(0, 10),
      to: toStr,
      keyResults,
      objective: objectiveLine,
      expected,
    };
  }

  /**
   * Ghi MỘT lần đổi giá trị của KR nhập tay trong transaction `tx`: cập nhật `currentValue` CÓ ĐIỀU KIỆN (chỉ khi vẫn
   * bằng `previous` — người khác chen vào giữa thì 409, không ghi đè) rồi ghi dòng lịch sử với `previousValue` đúng.
   * `extra`: các trường KR khác cần cập nhật cùng lúc (sửa từ form).
   */
  private async recordValueChange(
    tx: Prisma.TransactionClient,
    keyResultId: string,
    previous: number,
    value: number,
    note: string | null,
    authorId: string,
    extra: Prisma.KeyResultUpdateManyMutationInput = {},
  ): Promise<void> {
    const res = await tx.keyResult.updateMany({
      where: { id: keyResultId, currentValue: previous },
      data: { ...extra, currentValue: value },
    });
    if (res.count === 0) {
      const now = await tx.keyResult.findFirst({
        where: { id: keyResultId },
        select: { currentValue: true },
      });
      if (!now) throw new NotFoundAppException('Kết quả then chốt');
      throw this.valueConflict(now.currentValue);
    }
    await tx.keyResultCheckIn.create({
      data: { keyResultId, value, previousValue: previous, note, authorId },
    });
  }

  private valueConflict(current: number): VersionConflictException {
    return new VersionConflictException(
      `Giá trị của kết quả này vừa được người khác cập nhật thành ${current} — hãy tải lại rồi thử lại`,
      { currentValue: current },
    );
  }

  async removeKeyResult(
    workspaceId: string,
    objectiveId: string,
    keyResultId: string,
    viewerId: string,
  ) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    await this.requireObjective(workspaceId, objectiveId, visible);
    const { count } = await this.prisma.keyResult.deleteMany({
      where: { id: keyResultId, objectiveId },
    });
    if (count === 0) throw new NotFoundAppException('Kết quả then chốt');
    return this.read(workspaceId, objectiveId, visible, viewerId);
  }

  // ───────────────────────── issues gắn kèm ─────────────────────────

  async addIssues(workspaceId: string, objectiveId: string, issueIds: string[], viewerId: string) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    const objective = await this.requireObjective(workspaceId, objectiveId, visible);
    const ids = await this.validateIssues(workspaceId, issueIds, objective.projectId, visible);
    await this.prisma.objectiveIssue.createMany({
      data: ids.map((issueId) => ({ objectiveId, issueId })),
      skipDuplicates: true,
    });
    return this.read(workspaceId, objectiveId, visible, viewerId);
  }

  async removeIssues(
    workspaceId: string,
    objectiveId: string,
    issueIds: string[],
    viewerId: string,
  ) {
    const visible = await this.visibleFor(workspaceId, viewerId);
    await this.requireObjective(workspaceId, objectiveId, visible);
    await this.prisma.objectiveIssue.deleteMany({
      // Chỉ gỡ việc thuộc dự án người gọi thấy (không dò/gỡ liên kết tới việc của dự án ẩn).
      where: { objectiveId, issueId: { in: issueIds }, issue: { project: visible } },
    });
    return this.read(workspaceId, objectiveId, visible, viewerId);
  }

  // ───────────────────────── helpers ─────────────────────────

  /**
   * Kiểm + chuẩn hoá nguồn số liệu của một KR: cấu hình đúng theo nguồn, dự án thuộc workspace và người sửa thấy,
   * JQL hợp lệ (cú pháp + giá trị). Cấu hình sai → 422 với thông điệp tiếng Việt.
   */
  private async resolveSource(
    workspaceId: string,
    viewerId: string,
    kr: { source?: KeyResultSource; sourceConfig?: Record<string, unknown> | null },
    prev?: { source: KeyResultSource; sourceConfig: Prisma.JsonValue | null },
  ): Promise<{
    source: KeyResultSource;
    sourceConfig: Prisma.InputJsonValue | typeof Prisma.DbNull;
  }> {
    const source = kr.source ?? 'MANUAL';
    let config: ReturnType<typeof parseSourceConfig>;
    try {
      config = parseSourceConfig(source, kr.sourceConfig);
    } catch (err) {
      if (err instanceof ZodError)
        throw new BusinessRuleException(
          err.issues[0]?.message ?? 'Cấu hình nguồn số liệu không hợp lệ',
        );
      throw err;
    }
    // Chỉ kiểm lại khi nguồn/cấu hình THAY ĐỔI so với bản đang lưu: lưu form không bị chặn bởi KR cũ mà người sửa
    // không còn thấy dự án của nó, và không tốn N lần validate JQL mỗi lần lưu.
    const unchanged = !!prev && prev.source === source && sameJson(prev.sourceConfig, config);
    if (source !== 'MANUAL' && !unchanged)
      await this.measurer.validateConfig(workspaceId, viewerId, source, config);
    return { source, sourceConfig: config ?? Prisma.DbNull };
  }

  /** Các trường KR trừ `currentValue` (dùng khi sửa KR đang có: số hiện tại đi qua đường check-in). */
  private krFields(
    kr: KeyResultUpsertInput | CreateKeyResultInput,
    src: { source: KeyResultSource; sourceConfig: Prisma.InputJsonValue | typeof Prisma.DbNull },
  ) {
    return {
      name: kr.name.trim(),
      unit: kr.unit ?? 'NUMBER',
      startValue: kr.startValue ?? 0,
      targetValue: kr.targetValue,
      source: src.source,
      sourceConfig: src.sourceConfig,
      unitLabel: kr.unitLabel?.trim() || null,
    };
  }

  private krCreateData(
    kr: KeyResultUpsertInput | CreateKeyResultInput,
    src: { source: KeyResultSource; sourceConfig: Prisma.InputJsonValue | typeof Prisma.DbNull },
  ) {
    return {
      ...this.krFields(kr, src),
      // KR tự đo bỏ qua `currentValue` gửi lên: số hiển thị là số đo, DB giữ điểm xuất phát.
      currentValue:
        src.source === 'MANUAL' ? (kr.currentValue ?? kr.startValue ?? 0) : (kr.startValue ?? 0),
    };
  }

  private async requireObjective(
    workspaceId: string,
    id: string,
    visible: Prisma.ProjectWhereInput,
  ) {
    const row = await this.prisma.objective.findFirst({
      where: {
        id,
        workspaceId,
        ...this.scopeOf(visible),
      },
      select: { id: true, projectId: true, project: { select: { archivedAt: true } } },
    });
    if (!row) throw new NotFoundAppException('Mục tiêu');
    // Mọi lời gọi đều là thao tác ghi (đọc đi qua `get`): mục tiêu của dự án lưu trữ là chỉ đọc.
    assertNotArchived(row.project?.archivedAt);
    return row;
  }

  private async resolveProject(
    workspaceId: string,
    projectId: string | null,
    visible: Prisma.ProjectWhereInput,
  ): Promise<string | null> {
    if (!projectId) return null;
    const p = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspaceId,
        deletedAt: null,
        ...visible,
      },
      select: { id: true, archivedAt: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    assertNotArchived(p.archivedAt);
    return p.id;
  }

  private async resolveOwner(workspaceId: string, ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;
    const m = await this.prisma.workspaceMembership.findFirst({
      where: { workspaceId, userId: ownerId },
      select: { userId: true },
    });
    if (!m)
      throw new ForbiddenAppException(
        'Chủ sở hữu không thuộc không gian làm việc này — hãy chọn một thành viên khác',
      );
    return m.userId;
  }

  /** Issue phải thuộc workspace (và thuộc đúng dự án nếu mục tiêu gắn với 1 dự án). */
  private async validateIssues(
    workspaceId: string,
    issueIds: string[],
    projectId: string | null,
    visible: Prisma.ProjectWhereInput,
  ): Promise<string[]> {
    const unique = [...new Set(issueIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.issue.findMany({
      where: {
        id: { in: unique },
        workspaceId,
        deletedAt: null,
        project: { deletedAt: null, ...visible },
        ...(projectId ? { projectId } : {}),
      },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new ForbiddenAppException(
        projectId
          ? 'Một số công việc không thuộc dự án của mục tiêu này — hãy bỏ chọn những công việc đó'
          : 'Một số công việc không thuộc không gian làm việc này — hãy bỏ chọn những công việc đó',
      );
    }
    return unique;
  }

  private toDto(o: ObjectiveRow, ctx: DtoContext) {
    // Phần thời gian đã trôi của kỳ (0–100; null với kỳ tự do) — chỉ đọc, tính mỗi lần trả, không lưu. KR dùng chung giá trị
    // này làm vạch "kỳ vọng" trên thanh tiến độ.
    const expected = expectedProgress(o.period, new Date());
    const keyResults = o.keyResults.map((kr) => {
      const m = ctx.measured.get(kr.id);
      // KR tự đo: số hiện tại = số đo trực tiếp; đo lỗi → giữ giá trị cũ trong DB (kèm `measureError`).
      const currentValue = m?.value ?? kr.currentValue;
      return {
        id: kr.id,
        name: kr.name,
        unit: kr.unit,
        startValue: kr.startValue,
        targetValue: kr.targetValue,
        currentValue,
        source: kr.source,
        // Người xem không đủ quyền: chỉ `source` (+ nhãn tóm tắt ở FE), không lộ projectId/JQL.
        sourceConfig: ctx.canShowConfig(kr) ? kr.sourceConfig : null,
        measuredAt: m?.measuredAt ?? null,
        measureError: m?.error ?? null,
        unitLabel: kr.unitLabel,
        checkInCount: kr._count.checkIns,
        lastCheckInAt: kr.checkIns[0]?.createdAt.toISOString() ?? null,
        progress: krProgress(kr.startValue, kr.targetValue, currentValue),
        expectedProgress: expected,
      };
    });

    const issues = o.issues.map((oi) => ({
      id: oi.issue.id,
      key: oi.issue.key,
      summary: oi.issue.summary,
      typeName: oi.issue.type?.name ?? null,
      typeColor: oi.issue.type?.color ?? null,
      statusName: oi.issue.status?.name ?? null,
      statusCategory: oi.issue.status?.category ?? null,
      statusColor: oi.issue.status?.color ?? null,
    }));

    const doneCount = issues.filter((i) => i.statusCategory === 'DONE').length;
    // KR đo lỗi (số cũ/điểm xuất phát) không kéo trung bình tiến độ mục tiêu xuống.
    const counted = keyResults.filter((kr) => !kr.measureError);
    const keyResultProgress = counted.length
      ? Math.round(counted.reduce((s, kr) => s + kr.progress, 0) / counted.length)
      : null;
    const issueProgress = issues.length ? Math.round((doneCount / issues.length) * 100) : null;

    return {
      id: o.id,
      workspaceId: o.workspaceId,
      projectId: o.projectId,
      project: o.project,
      name: o.name,
      description: o.description,
      period: o.period,
      status: o.status,
      owner: o.owner,
      keyResults,
      issues,
      issueCount: issues.length,
      issueDoneCount: doneCount,
      keyResultProgress,
      issueProgress,
      /** Tiến độ hiển thị: ưu tiên Key Result; chưa có KR thì lấy % issue Done. */
      progress: keyResultProgress ?? issueProgress ?? 0,
      /** Phần thời gian đã trôi của kỳ (vạch kỳ vọng); null khi kỳ không phải dạng `YYYY-Qn`. */
      expectedProgress: expected,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}
