import { Injectable } from '@nestjs/common';
import { HistoryField, Prisma, StatusCategory } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { cursorPage, PageResult } from '../../common/dto/page-result';

/** Tác nhân (người dùng) đã được phân giải cho một dòng lịch sử. */
export interface ActivityActor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** DTO cho hoạt động trên một issue. */
export interface IssueActivityDto {
  id: string;
  field: HistoryField;
  oldValue: string | null;
  newValue: string | null;
  /** Nhãn hiển thị đã phân giải cho oldValue (vd id user → tên, id sprint → tên). */
  oldLabel: string | null;
  /** Nhãn hiển thị đã phân giải cho newValue. */
  newLabel: string | null;
  oldCategory: StatusCategory | null;
  newCategory: StatusCategory | null;
  pointsDelta: number | null;
  actor: ActivityActor | null;
  occurredAt: string;
  /** `true` khi dòng có bản cũ/mới đầy đủ để so sánh (DESCRIPTION); khi đó oldValue/newValue/oldLabel/newLabel chỉ là bản xem trước. */
  hasDiff: boolean;
}

/** Một dòng lịch sử với giá trị ĐẦY ĐỦ (không cắt) — cho hộp so sánh mô tả. */
export interface IssueActivityDetailDto {
  id: string;
  field: HistoryField;
  oldValue: string | null;
  newValue: string | null;
  occurredAt: string;
  actor: ActivityActor | null;
}

/** DTO cho hoạt động ở phạm vi project — kèm issue đích (id + key + summary). */
export interface ProjectActivityDto extends IssueActivityDto {
  issueId: string;
  issueKey: string;
  issueSummary: string;
}

/** Số ký tự tối đa của bản xem trước mô tả trong danh sách (đầy đủ lấy qua `getOne`). */
const PREVIEW = 200;
const preview = (s: string | null): string | null => {
  if (s == null) return null;
  const chars = [...s];
  return chars.length > PREVIEW ? `${chars.slice(0, PREVIEW).join('')}…` : s;
};

/** Các trường cần lấy từ IssueHistory cho truy vấn activity của một issue. */
const historySelect = {
  id: true,
  issueId: true,
  field: true,
  oldValue: true,
  newValue: true,
  oldCategory: true,
  newCategory: true,
  pointsDelta: true,
  actorId: true,
  occurredAt: true,
} satisfies Prisma.IssueHistorySelect;

/** Với activity phạm vi project, kèm thêm key + summary của issue đích để hiển thị. */
const projectHistorySelect = {
  ...historySelect,
  issue: { select: { key: true, summary: true } },
} satisfies Prisma.IssueHistorySelect;

type HistoryRow = Prisma.IssueHistoryGetPayload<{ select: typeof historySelect }>;
type ProjectHistoryRow = Prisma.IssueHistoryGetPayload<{ select: typeof projectHistorySelect }>;

/** Bảng phân giải id → nhãn hiển thị cho các field lưu id (ASSIGNEE, SPRINT). */
interface LabelMaps {
  actors: Map<string, ActivityActor>;
  users: Map<string, string>;
  sprints: Map<string, string>;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hoạt động của một issue — mới nhất trước, tối đa 100 dòng. Trả mảng phẳng.
   * `fields` (tuỳ chọn) lọc theo loại thay đổi; mô tả chỉ trả bản xem trước (xem `getOne` cho bản đầy đủ).
   */
  async listForIssue(
    workspaceId: string,
    issueId: string,
    fields?: HistoryField[],
  ): Promise<IssueActivityDto[]> {
    await this.requireIssue(workspaceId, issueId);

    const rows = await this.prisma.issueHistory.findMany({
      where: { issueId, ...(fields?.length ? { field: { in: fields } } : {}) },
      select: historySelect,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });

    const maps = await this.resolveLabels(rows);
    return rows.map((r) => this.toIssueDto(r, maps));
  }

  /** Một dòng lịch sử với giá trị đầy đủ (không cắt). 404 nếu không thuộc công việc này. */
  async getOne(
    workspaceId: string,
    issueId: string,
    activityId: string,
  ): Promise<IssueActivityDetailDto> {
    await this.requireIssue(workspaceId, issueId);
    const row = await this.prisma.issueHistory.findFirst({
      where: { id: activityId, issueId },
      select: historySelect,
    });
    if (!row) throw new NotFoundAppException('Lịch sử');
    const maps = await this.resolveLabels([row]);
    return {
      id: row.id,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      occurredAt: row.occurredAt.toISOString(),
      actor: maps.actors.get(row.actorId) ?? null,
    };
  }

  private async requireIssue(workspaceId: string, issueId: string): Promise<void> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
  }

  /**
   * Hoạt động của một project — mới nhất trước, phân trang theo cursor (id dòng cuối).
   * Dùng keyset trên [occurredAt, id] vì PK của IssueHistory là composite.
   */
  async listForProject(
    workspaceId: string,
    projectId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PageResult<ProjectActivityDto>> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');

    const where: Prisma.IssueHistoryWhereInput = { projectId };
    if (cursor) {
      const cur = await this.prisma.issueHistory.findFirst({
        where: { id: cursor, projectId },
        select: { occurredAt: true },
      });
      if (cur) {
        where.OR = [
          { occurredAt: { lt: cur.occurredAt } },
          { occurredAt: cur.occurredAt, id: { lt: cursor } },
        ];
      }
    }

    const rows = await this.prisma.issueHistory.findMany({
      where,
      select: projectHistorySelect,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const maps = await this.resolveLabels(rows);
    return cursorPage(
      rows.map((r) => this.toProjectDto(r, maps)),
      limit,
      (i) => i.id,
    );
  }

  /**
   * Phân giải nhãn hiển thị theo lô cho một trang lịch sử:
   *  - actor (actorId → tên + avatar);
   *  - user (ASSIGNEE lưu id user ở old/newValue → tên);
   *  - sprint (SPRINT lưu id sprint ở old/newValue → tên).
   * IssueHistory không có relation tới User/Sprint nên phải tự resolve.
   */
  private async resolveLabels(rows: HistoryRow[]): Promise<LabelMaps> {
    const actorIds = new Set<string>();
    const userIds = new Set<string>();
    const sprintIds = new Set<string>();

    for (const r of rows) {
      actorIds.add(r.actorId);
      if (r.field === 'ASSIGNEE') {
        if (r.oldValue) userIds.add(r.oldValue);
        if (r.newValue) userIds.add(r.newValue);
      } else if (r.field === 'SPRINT') {
        if (r.oldValue) sprintIds.add(r.oldValue);
        if (r.newValue) sprintIds.add(r.newValue);
      }
    }

    // Actor cũng là user → gộp vào một truy vấn user duy nhất.
    for (const id of actorIds) userIds.add(id);

    const [users, sprints] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, displayName: true, avatarUrl: true },
          })
        : Promise.resolve([]),
      sprintIds.size
        ? // allow-deleted: chỉ tra tên để hiển thị lịch sử — sprint đã xoá vẫn phải hiện đúng tên
          this.prisma.sprint.findMany({
            where: { id: { in: [...sprintIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const actors = new Map<string, ActivityActor>();
    const userNames = new Map<string, string>();
    for (const u of users) {
      userNames.set(u.id, u.displayName);
      if (actorIds.has(u.id)) actors.set(u.id, u);
    }
    const sprintNames = new Map(sprints.map((s): [string, string] => [s.id, s.name]));

    return { actors, users: userNames, sprints: sprintNames };
  }

  /** Nhãn hiển thị cho một giá trị id-based (ASSIGNEE/SPRINT); các field khác dùng chính value. */
  private labelFor(field: HistoryField, value: string | null, maps: LabelMaps): string | null {
    if (value == null || value === '') return null;
    if (field === 'ASSIGNEE') return maps.users.get(value) ?? 'Người dùng đã xóa';
    if (field === 'SPRINT') return maps.sprints.get(value) ?? 'Sprint đã xóa';
    return value;
  }

  private toIssueDto(row: HistoryRow, maps: LabelMaps): IssueActivityDto {
    // Mô tả có thể tới 50k ký tự/dòng × 100 dòng: danh sách chỉ mang bản xem trước.
    const isDesc = row.field === 'DESCRIPTION';
    const oldValue = isDesc ? preview(row.oldValue) : row.oldValue;
    const newValue = isDesc ? preview(row.newValue) : row.newValue;
    return {
      id: row.id,
      field: row.field,
      oldValue,
      newValue,
      oldLabel: isDesc ? oldValue : this.labelFor(row.field, row.oldValue, maps),
      newLabel: isDesc ? newValue : this.labelFor(row.field, row.newValue, maps),
      hasDiff: isDesc,
      oldCategory: row.oldCategory,
      newCategory: row.newCategory,
      pointsDelta: row.pointsDelta,
      actor: maps.actors.get(row.actorId) ?? null,
      occurredAt: row.occurredAt.toISOString(),
    };
  }

  private toProjectDto(row: ProjectHistoryRow, maps: LabelMaps): ProjectActivityDto {
    return {
      ...this.toIssueDto(row, maps),
      issueId: row.issueId,
      issueKey: row.issue.key,
      issueSummary: row.issue.summary,
    };
  }
}
