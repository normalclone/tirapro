import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';

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
  constructor(private readonly prisma: PrismaService) {}

  /** Xuất toàn bộ một project ra JSON tự chứa. Chỉ đọc, không thay đổi dữ liệu. */
  async exportProject(workspaceId: string, projectId: string): Promise<ProjectExport> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, name: true, description: true, type: true },
    });
    if (!project) throw new NotFoundAppException('Project');

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
