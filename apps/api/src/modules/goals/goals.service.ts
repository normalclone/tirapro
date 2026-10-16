import { Injectable } from '@nestjs/common';
import { Prisma, type KeyResultSource, type ObjectiveStatus } from '@prisma/client';
import { ZodError } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { assertNotArchived } from '../../common/project-writable';
import { ProjectAccessService } from '../rbac/project-access.service';
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
        _count: { select: { checkIns: true } },
        checkIns: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { createdAt: true } },
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

/** Kẹp về [0,1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
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
  ) {}

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
    const measured = await this.measureAll(workspaceId, viewerId, rows);
    return rows.map((r) => this.toDto(r, measured));
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
    return this.toDto(row, await this.measureAll(workspaceId, viewerId, [row]));
  }

  /** Đo mọi KR tự đo của các mục tiêu trong MỘT lượt (KR cùng cấu hình đo một lần). Không có KR tự đo → không đo. */
  private async measureAll(
    workspaceId: string,
    viewerId: string,
    rows: ObjectiveRow[],
  ): Promise<Map<string, MeasureResult>> {
    const auto = rows
      .flatMap((r) => r.keyResults)
      .filter((kr) => kr.source !== 'MANUAL')
      .map((kr) => ({ id: kr.id, source: kr.source, sourceConfig: kr.sourceConfig }));
    if (auto.length === 0) return new Map();
    return this.measurer.measure(workspaceId, viewerId, auto);
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

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.objective.update({ where: { id }, data }),
    ];

    // Danh sách KR gửi lên = danh sách MỚI: có id → update, không id → create, thiếu → xoá.
    if (dto.keyResults !== undefined) {
      const existing = await this.prisma.keyResult.findMany({
        where: { objectiveId: id },
        select: { id: true, source: true, sourceConfig: true, currentValue: true },
      });
      const keptIds = new Set(dto.keyResults.map((kr) => kr.id).filter((v): v is string => !!v));
      const removed = existing.filter((kr) => !keptIds.has(kr.id)).map((kr) => kr.id);
      if (removed.length)
        ops.push(
          this.prisma.keyResult.deleteMany({ where: { id: { in: removed }, objectiveId: id } }),
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
        );
        if (kr.id && prev) {
          const { currentValue: nextValue, ...data } = this.krCreateData(kr, src);
          if (src.source === 'MANUAL') {
            // Không gửi `currentValue` → giữ giá trị hiện có (không vô tình đưa về điểm xuất phát).
            const value = kr.currentValue ?? prev.currentValue;
            ops.push(
              this.prisma.keyResult.update({
                where: { id: kr.id },
                data: { ...data, currentValue: value },
              }),
            );
            // Sửa số hiện tại ngay trong form cũng để lại dấu vết: cùng đường lịch sử với check-in.
            if (value !== prev.currentValue)
              ops.push(this.checkInCreate(kr.id, value, prev.currentValue, null, viewerId));
          } else {
            // KR tự đo: `currentValue` trong DB (giá trị tay lần cuối) giữ nguyên, không bị ghi đè.
            void nextValue;
            ops.push(this.prisma.keyResult.update({ where: { id: kr.id }, data }));
          }
        } else {
          ops.push(
            this.prisma.keyResult.create({
              data: { objectiveId: id, ...this.krCreateData(kr, src) },
            }),
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
      ops.push(
        this.prisma.objectiveIssue.deleteMany({
          where: { objectiveId: id, issue: { project: visible } },
        }),
      );
      if (issueIds.length) {
        ops.push(
          this.prisma.objectiveIssue.createMany({
            data: issueIds.map((issueId) => ({ objectiveId: id, issueId })),
          }),
        );
      }
    }

    await this.prisma.$transaction(ops);
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
    await this.prisma.keyResult.create({ data: { objectiveId, ...this.krCreateData(dto, src) } });
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

    const data: Prisma.KeyResultUpdateInput = {};
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
    if (dto.source !== undefined || dto.sourceConfig !== undefined) {
      const src = await this.resolveSource(workspaceId, viewerId, {
        source,
        // Đổi nguồn mà không gửi cấu hình mới thì dùng cấu hình cũ (kiểm lại — có thể không khớp nguồn mới).
        sourceConfig:
          dto.sourceConfig !== undefined
            ? dto.sourceConfig
            : (kr.sourceConfig as Record<string, unknown> | null),
      });
      data.source = src.source;
      data.sourceConfig = src.sourceConfig;
    }

    // KR tự đo bỏ qua `currentValue` gửi lên (số đo tính lúc đọc). KR nhập tay: đổi số đi qua cùng đường
    // check-in (một dòng lịch sử + cập nhật trong một transaction) để lịch sử là nguồn sự thật duy nhất.
    const changed =
      dto.currentValue !== undefined && source === 'MANUAL' && dto.currentValue !== kr.currentValue;
    if (changed) {
      data.currentValue = dto.currentValue;
      await this.prisma.$transaction([
        this.prisma.keyResult.update({ where: { id: keyResultId }, data }),
        this.checkInCreate(keyResultId, dto.currentValue!, kr.currentValue, null, viewerId),
      ]);
    } else {
      await this.prisma.keyResult.update({ where: { id: keyResultId }, data });
    }
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
    const kr = await this.prisma.keyResult.findFirst({
      where: { id: keyResultId, objectiveId },
      select: { id: true, source: true, currentValue: true },
    });
    if (!kr) throw new NotFoundAppException('Kết quả then chốt');
    if (kr.source !== 'MANUAL')
      throw new BusinessRuleException('Kết quả này tự đo từ dữ liệu — không nhập tay');
    await this.prisma.$transaction([
      this.checkInCreate(keyResultId, dto.value, kr.currentValue, dto.note ?? null, viewerId),
      this.prisma.keyResult.update({
        where: { id: keyResultId },
        data: { currentValue: dto.value },
      }),
    ]);
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
      where: { keyResultId },
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

  private checkInCreate(
    keyResultId: string,
    value: number,
    previousValue: number | null,
    note: string | null,
    authorId: string,
  ) {
    return this.prisma.keyResultCheckIn.create({
      data: { keyResultId, value, previousValue, note, authorId },
    });
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
    if (source !== 'MANUAL')
      await this.measurer.validateConfig(workspaceId, viewerId, source, config);
    return { source, sourceConfig: config ?? Prisma.DbNull };
  }

  private krCreateData(
    kr: KeyResultUpsertInput | CreateKeyResultInput,
    src: { source: KeyResultSource; sourceConfig: Prisma.InputJsonValue | typeof Prisma.DbNull },
  ) {
    return {
      name: kr.name.trim(),
      unit: kr.unit ?? 'NUMBER',
      startValue: kr.startValue ?? 0,
      targetValue: kr.targetValue,
      // KR tự đo bỏ qua `currentValue` gửi lên: số hiển thị là số đo, DB giữ điểm xuất phát.
      currentValue:
        src.source === 'MANUAL' ? (kr.currentValue ?? kr.startValue ?? 0) : (kr.startValue ?? 0),
      source: src.source,
      sourceConfig: src.sourceConfig,
      unitLabel: kr.unitLabel?.trim() || null,
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

  private toDto(o: ObjectiveRow, measured: Map<string, MeasureResult>) {
    const keyResults = o.keyResults.map((kr) => {
      const m = measured.get(kr.id);
      // KR tự đo: số hiện tại = số đo trực tiếp; đo lỗi → giữ giá trị cũ trong DB (kèm `measureError`).
      const currentValue = m?.value ?? kr.currentValue;
      const span = kr.targetValue - kr.startValue;
      const ratio =
        span === 0
          ? currentValue >= kr.targetValue
            ? 1
            : 0
          : clamp01((currentValue - kr.startValue) / span);
      return {
        id: kr.id,
        name: kr.name,
        unit: kr.unit,
        startValue: kr.startValue,
        targetValue: kr.targetValue,
        currentValue,
        source: kr.source,
        sourceConfig: kr.sourceConfig,
        measuredAt: m?.measuredAt ?? null,
        measureError: m?.error ?? null,
        unitLabel: kr.unitLabel,
        checkInCount: kr._count.checkIns,
        lastCheckInAt: kr.checkIns[0]?.createdAt.toISOString() ?? null,
        progress: Math.round(ratio * 100),
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
    const keyResultProgress = keyResults.length
      ? Math.round(keyResults.reduce((s, kr) => s + kr.progress, 0) / keyResults.length)
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
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}
