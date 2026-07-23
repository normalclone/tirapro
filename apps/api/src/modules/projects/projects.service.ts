import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  SYSTEM_ROLES,
  type ProjectDto,
} from '@tirapro/types';
import type { CreateProjectInput } from '@tirapro/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { MediaService } from '../media/media.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async create(workspaceId: string, userId: string, input: CreateProjectInput): Promise<ProjectDto> {
    const dup = await this.prisma.project.findFirst({
      where: { workspaceId, key: input.key, deletedAt: null },
      select: { id: true },
    });
    if (dup) throw new BusinessRuleException(`Project key "${input.key}" đã tồn tại trong workspace`);

    const tpl =
      DEFAULT_WORKFLOW_TEMPLATES.find((t) => t.boardType === input.type) ??
      DEFAULT_WORKFLOW_TEMPLATES.find((t) => t.isDefault) ??
      DEFAULT_WORKFLOW_TEMPLATES[0]!;

    const adminRole = await this.prisma.role.findFirst({
      where: { name: SYSTEM_ROLES.PROJECT_ADMIN, scope: 'PROJECT', workspaceId: null, isSystem: true },
      select: { id: true },
    });

    const project = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          workspaceId,
          key: input.key,
          name: input.name,
          type: input.type,
          description: input.description ?? null,
          leadId: input.leadId ?? userId,
          createdById: userId,
        },
      });

      // Clone workflow từ template (config-driven) → workflow riêng của project
      const workflow = await tx.workflow.create({
        data: {
          workspaceId,
          projectId: project.id,
          isTemplate: false,
          isDefault: true,
          name: tpl.name,
          description: tpl.description,
        },
      });
      const statusByName = new Map<string, string>();
      for (const s of tpl.statuses) {
        const row = await tx.status.create({
          data: { workflowId: workflow.id, name: s.name, category: s.category, color: s.color, order: s.order, isInitial: !!s.isInitial },
        });
        statusByName.set(s.name, row.id);
      }
      let tOrder = 0;
      for (const t of tpl.transitions) {
        await tx.workflowTransition.create({
          data: {
            workflowId: workflow.id,
            name: t.name,
            fromStatusId: t.from ? (statusByName.get(t.from) ?? null) : null,
            toStatusId: statusByName.get(t.to)!,
            order: tOrder++,
          },
        });
      }
      await tx.project.update({ where: { id: project.id }, data: { defaultWorkflowId: workflow.id } });

      // Board mặc định: 1 cột / status
      const board = await tx.board.create({
        data: { projectId: project.id, name: `${project.name} Board`, type: input.type === 'KANBAN' ? 'KANBAN' : 'SCRUM' },
      });
      let cOrder = 0;
      for (const s of tpl.statuses) {
        const col = await tx.boardColumn.create({ data: { boardId: board.id, name: s.name, order: cOrder++ } });
        await tx.boardColumnStatus.create({ data: { columnId: col.id, statusId: statusByName.get(s.name)! } });
      }

      // Người tạo = Project Admin
      if (adminRole) {
        await tx.projectMembership.create({ data: { projectId: project.id, userId, roleId: adminRole.id } });
      }
      return project;
    });

    return this.toDto(project, 0);
  }

  async list(workspaceId: string): Promise<ProjectDto[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { issues: true } }, lead: true },
    });
    return projects.map((p) => this.toDto(p, p._count.issues, p.lead));
  }

  async getByKey(workspaceId: string, key: string): Promise<ProjectDto> {
    const p = await this.prisma.project.findFirst({
      where: { workspaceId, key, deletedAt: null },
      include: { _count: { select: { issues: true } }, lead: true },
    });
    if (!p) throw new NotFoundAppException('Project');
    return this.toDto(p, p._count.issues, p.lead);
  }

  /** Đặt ảnh đại diện project (xoá ảnh cũ best-effort). Trả về ProjectDto đầy đủ. */
  async setAvatar(workspaceId: string, key: string, file: Express.Multer.File | undefined, req: Request): Promise<ProjectDto> {
    const prev = await this.prisma.project.findFirst({
      where: { workspaceId, key, deletedAt: null },
      select: { id: true, avatarUrl: true },
    });
    if (!prev) throw new NotFoundAppException('Project');
    const avatarUrl = await this.media.saveAvatar(file, 'proj', req);
    await this.prisma.project.update({ where: { id: prev.id }, data: { avatarUrl } });
    await this.media.removeByUrl(prev.avatarUrl);
    return this.getByKey(workspaceId, key);
  }

  /** Gỡ ảnh đại diện project. */
  async clearAvatar(workspaceId: string, key: string): Promise<ProjectDto> {
    const prev = await this.prisma.project.findFirst({
      where: { workspaceId, key, deletedAt: null },
      select: { id: true, avatarUrl: true },
    });
    if (!prev) throw new NotFoundAppException('Project');
    await this.prisma.project.update({ where: { id: prev.id }, data: { avatarUrl: null } });
    await this.media.removeByUrl(prev.avatarUrl);
    return this.getByKey(workspaceId, key);
  }

  /** Config tạo issue: issue types + priorities của workspace (cho quick-add / AI generate). */
  async meta(workspaceId: string, key: string) {
    const project = await this.prisma.project.findFirst({
      where: { workspaceId, key, deletedAt: null },
      select: { id: true, key: true },
    });
    if (!project) throw new NotFoundAppException('Project');
    const [issueTypes, priorities] = await Promise.all([
      this.prisma.issueType.findMany({
        where: { workspaceId },
        orderBy: { hierarchyLevel: 'asc' },
        select: { id: true, name: true, key: true, color: true, iconUrl: true, isSubtask: true },
      }),
      this.prisma.priority.findMany({
        where: { workspaceId },
        orderBy: { rank: 'desc' },
        select: { id: true, name: true, color: true, rank: true, isDefault: true },
      }),
    ]);
    return { projectId: project.id, issueTypes, priorities };
  }

  private toDto(
    p: Prisma.ProjectGetPayload<object>,
    issueCount: number,
    lead?: { id: string; email: string; displayName: string; avatarUrl: string | null } | null,
  ): ProjectDto {
    return {
      id: p.id,
      workspaceId: p.workspaceId,
      key: p.key,
      name: p.name,
      description: p.description,
      type: p.type,
      leadId: p.leadId,
      lead: lead
        ? ({ id: lead.id, email: lead.email, displayName: lead.displayName, avatarUrl: lead.avatarUrl } as ProjectDto['lead'])
        : null,
      avatarUrl: p.avatarUrl,
      defaultAssigneeMode: p.defaultAssigneeMode,
      isArchived: p.isArchived,
      issueCount,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
