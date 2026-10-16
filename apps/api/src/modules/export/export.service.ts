import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toCsv } from '@tirapro/shared';
import type { IssueDto } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import type { PageResult } from '../../common/dto/page-result';
import { IssuesService } from '../issues/issues.service';
import { SearchService } from '../search/search.service';
import {
  ISSUE_CSV_COLUMN_DEFS,
  resolveIssueCsvColumns,
  type ExportRow,
  type IssuesCsvQuery,
} from './issues-csv';

/** Mỗi trang 200 (trần của tìm kiếm), tối đa 25 trang = 5.000 dòng. */
const CSV_PAGE_SIZE = 200;
const CSV_MAX_ROWS = 5000;

/** Include đầy đủ cho mỗi issue khi export (round-trippable với import CSV/JSON). */
const exportIssueInclude = {
  type: true,
  status: true,
  priority: true,
  resolution: true,
  assignee: true,
  reporter: true,
  sprint: true,
  labels: { include: { label: true } },
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { author: true },
  },
} satisfies Prisma.IssueInclude;

type ExportIssueRow = Prisma.IssueGetPayload<{ include: typeof exportIssueInclude }>;

/** Bản export JSON tự chứa của một project (data portability, chống vendor lock-in). */
export interface ProjectExport {
  exportedAt: string;
  schemaVersion: number;
  project: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    type: string;
  };
  sprints: Array<{
    id: string;
    name: string;
    goal: string | null;
    state: string;
    startDate: string | null;
    endDate: string | null;
    sequence: number;
  }>;
  labels: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  issues: Array<{
    key: string;
    summary: string;
    description: string | null;
    descriptionFormat: string;
    type: string;
    status: string;
    statusCategory: string;
    priority: string | null;
    resolution: string | null;
    assignee: string | null;
    reporter: string | null;
    storyPoints: number | null;
    sprint: string | null;
    labels: string[];
    createdAt: string;
    updatedAt: string;
    comments: Array<{
      author: string | null;
      body: string;
      createdAt: string;
    }>;
  }>;
}

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
    private readonly search: SearchService,
  ) {}

  /**
   * CSV công việc cho Việc chờ / danh sách bug / sprint / kết quả JQL. Đi qua service đã lọc theo người xem
   * (`viewerId = userId`: dự án riêng tư người xuất không thấy thì không có dòng nào). Lặp con trỏ tới hết hoặc
   * `CSV_MAX_ROWS`; chạm trần thì cắt và `truncated: true`.
   */
  async exportIssuesCsv(
    workspaceId: string,
    userId: string,
    q: IssuesCsvQuery,
  ): Promise<{ csv: string; truncated: boolean; filename: string }> {
    const { projectId, jql, preset, sprintId } = q;
    const hasJql = !!jql?.trim();
    if ((preset || sprintId) && !projectId) {
      throw new BusinessRuleException(
        'Xuất theo Việc chờ / bug / sprint cần chọn dự án (projectId).',
      );
    }
    if (hasJql && (preset || sprintId)) {
      throw new BusinessRuleException(
        'Chỉ chọn một nguồn: truy vấn JQL hoặc Việc chờ / bug / sprint.',
      );
    }
    if (preset === 'backlog' && sprintId) {
      throw new BusinessRuleException('Việc chờ là việc chưa vào sprint — không kèm sprintId.');
    }
    if (!hasJql && !preset && !sprintId) {
      throw new BusinessRuleException(
        'Thiếu điều kiện xuất — dùng jql=…, hoặc preset=backlog|bugs, hoặc sprintId=… (kèm projectId).',
      );
    }

    const project = projectId
      ? await this.prisma.project.findFirst({
          where: { id: projectId, workspaceId, deletedAt: null },
          select: { id: true, key: true },
        })
      : null;
    if (projectId && !project) throw new NotFoundAppException('Dự án');
    const sprint =
      sprintId && projectId
        ? await this.prisma.sprint.findFirst({
            where: { id: sprintId, projectId, deletedAt: null, project: { workspaceId } },
            select: { id: true, name: true },
          })
        : null;
    if (sprintId && !sprint) throw new NotFoundAppException('Sprint');

    let fetchPage: (cursor: string | undefined) => Promise<PageResult<IssueDto>>;
    if (hasJql) {
      fetchPage = (cursor) =>
        this.search.search(workspaceId, userId, {
          mode: 'jql',
          jql,
          projectId,
          cursor,
          limit: CSV_PAGE_SIZE,
        });
    } else {
      const where: Prisma.IssueWhereInput = { projectId };
      let orderBy: Prisma.IssueOrderByWithRelationInput[] = [{ createdAt: 'desc' }];
      if (preset === 'backlog') {
        where.sprintId = null;
        where.status = { category: { not: 'DONE' } };
        orderBy = [{ rank: 'asc' }];
      }
      if (preset === 'bugs') where.type = { key: 'BUG' };
      if (sprint) {
        where.sprintId = sprint.id;
        orderBy = [{ rank: 'asc' }];
      }
      fetchPage = (cursor) =>
        this.issues.query(workspaceId, where, orderBy, cursor, CSV_PAGE_SIZE, userId);
    }

    const columnIds = resolveIssueCsvColumns(q.columns);
    const columns = columnIds.map((id) => ISSUE_CSV_COLUMN_DEFS[id]);
    const rows: ExportRow[] = [];
    const sprintNames = new Map<string, string>();
    const projectKeys = new Map<string, string>();
    let truncated = false;
    let cursor: string | undefined;
    for (;;) {
      const res = await fetchPage(cursor);
      const batch = res.data.slice(0, CSV_MAX_ROWS - rows.length);
      await this.fillNames(workspaceId, batch, columnIds, sprintNames, projectKeys);
      for (const i of batch) {
        rows.push({
          ...i,
          sprintName: i.sprintId ? (sprintNames.get(i.sprintId) ?? null) : null,
          projectKey: projectKeys.get(i.projectId) ?? null,
        });
      }
      const info = res.pageInfo;
      const next = 'hasNextPage' in info && info.hasNextPage ? info.endCursor : null;
      if (!next || res.data.length === 0) break;
      if (rows.length >= CSV_MAX_ROWS) {
        truncated = true;
        break;
      }
      cursor = next;
    }

    const delimiter = q.delimiter === 'semicolon' ? ';' : ',';
    const label = preset ?? (sprint ? `sprint-${slugify(sprint.name)}` : 'jql');
    return {
      csv: toCsv(rows, columns, { delimiter }),
      truncated,
      filename: `tirapro-${project?.key ?? 'workspace'}-${label}-${yyyymmdd(new Date())}.csv`,
    };
  }

  /** Nạp tên sprint / khoá dự án còn thiếu cho một lô (chỉ khi cột đó được xuất). */
  private async fillNames(
    workspaceId: string,
    batch: IssueDto[],
    columnIds: readonly string[],
    sprintNames: Map<string, string>,
    projectKeys: Map<string, string>,
  ): Promise<void> {
    if (columnIds.includes('sprint')) {
      const ids = [
        ...new Set(
          batch.map((i) => i.sprintId).filter((x): x is string => !!x && !sprintNames.has(x)),
        ),
      ];
      if (ids.length) {
        const found = await this.prisma.sprint.findMany({
          where: { id: { in: ids }, deletedAt: null, project: { workspaceId } },
          select: { id: true, name: true },
        });
        for (const s of found) sprintNames.set(s.id, s.name);
      }
    }
    if (columnIds.includes('project')) {
      const ids = [...new Set(batch.map((i) => i.projectId).filter((x) => !projectKeys.has(x)))];
      if (ids.length) {
        const found = await this.prisma.project.findMany({
          where: { id: { in: ids }, workspaceId, deletedAt: null },
          select: { id: true, key: true },
        });
        for (const p of found) projectKeys.set(p.id, p.key);
      }
    }
  }

  /** Xuất toàn bộ một project ra JSON tự chứa. Chỉ đọc, không thay đổi dữ liệu. */
  async exportProject(workspaceId: string, projectId: string): Promise<ProjectExport> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, name: true, description: true, type: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');

    const [sprints, labels, issues] = await Promise.all([
      this.prisma.sprint.findMany({
        where: { projectId: project.id, deletedAt: null },
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.label.findMany({
        where: { projectId: project.id },
        orderBy: { name: 'asc' },
      }),
      // TODO stream/paginate for very large projects (>5000 issues vẫn chạy nhưng trả một response duy nhất — chấp nhận cho MVP).
      this.prisma.issue.findMany({
        where: { projectId: project.id, deletedAt: null },
        include: exportIssueInclude,
        orderBy: { number: 'asc' },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        description: project.description,
        type: project.type,
      },
      sprints: sprints.map((s) => ({
        id: s.id,
        name: s.name,
        goal: s.goal,
        state: s.state,
        startDate: s.startDate?.toISOString() ?? null,
        endDate: s.endDate?.toISOString() ?? null,
        sequence: s.sequence,
      })),
      labels: labels.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
      issues: issues.map((i) => this.toIssueExport(i)),
    };
  }

  private toIssueExport(i: ExportIssueRow): ProjectExport['issues'][number] {
    return {
      key: i.key,
      summary: i.summary,
      description: i.description,
      descriptionFormat: i.descriptionFormat,
      type: i.type.name,
      status: i.status.name,
      statusCategory: i.status.category,
      priority: i.priority?.name ?? null,
      resolution: i.resolution?.name ?? null,
      assignee: i.assignee?.email ?? null,
      reporter: i.reporter?.email ?? null,
      storyPoints: i.storyPoints,
      sprint: i.sprint?.name ?? null,
      labels: i.labels.map((l) => l.label.name),
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      comments: i.comments.map((c) => ({
        author: c.author?.email ?? null,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}

/** `Sprint 2 — Ra mắt` → `sprint-2-ra-mat`: bỏ ký tự không phải chữ/số, giữ chữ có dấu để tên file đọc được. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'sprint';
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
