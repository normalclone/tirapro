import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DEFAULT_WORKFLOW_TEMPLATES, SYSTEM_ROLES, type ProjectDto } from '@tirapro/types';
import type {
  CreateProjectInput,
  ProjectHealthDto,
  SetProjectHealthInput,
  UpdateProjectInput,
} from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { iso } from '../../common/mappers/date';
import { assertNotArchived } from '../../common/project-writable';
import { MediaService } from '../media/media.service';
import { ProjectHealthService } from '../analytics/project-health.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly health: ProjectHealthService,
  ) {}

  async create(
    workspaceId: string,
    userId: string,
    input: CreateProjectInput,
  ): Promise<ProjectDto> {
    const dup = await this.prisma.project.findFirst({
      where: { workspaceId, key: input.key, deletedAt: null },
      select: { id: true },
    });
    if (dup)
      throw new BusinessRuleException(
        `Mã dự án "${input.key}" đã tồn tại trong không gian làm việc này — hãy chọn mã khác`,
      );

    const tpl =
      DEFAULT_WORKFLOW_TEMPLATES.find((t) => t.boardType === input.type) ??
      DEFAULT_WORKFLOW_TEMPLATES.find((t) => t.isDefault) ??
      DEFAULT_WORKFLOW_TEMPLATES[0]!;

    const adminRole = await this.prisma.role.findFirst({
      where: {
        name: SYSTEM_ROLES.PROJECT_ADMIN,
        scope: 'PROJECT',
        workspaceId: null,
        isSystem: true,
      },
      select: { id: true },
    });

    let project: Prisma.ProjectGetPayload<object>;
    try {
      project = await this.prisma.$transaction(async (tx) => {
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
            data: {
              workflowId: workflow.id,
              name: s.name,
              category: s.category,
              color: s.color,
              order: s.order,
              isInitial: !!s.isInitial,
            },
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
        await tx.project.update({
          where: { id: project.id },
          data: { defaultWorkflowId: workflow.id },
        });

        // Board mặc định: 1 cột / status
        const board = await tx.board.create({
          data: {
            projectId: project.id,
            name: `${project.name} Board`,
            type: input.type === 'KANBAN' ? 'KANBAN' : 'SCRUM',
          },
        });
        let cOrder = 0;
        for (const s of tpl.statuses) {
          const col = await tx.boardColumn.create({
            data: { boardId: board.id, name: s.name, order: cOrder++ },
          });
          await tx.boardColumnStatus.create({
            data: { columnId: col.id, statusId: statusByName.get(s.name)! },
          });
        }

        // Người tạo = Project Admin
        if (adminRole) {
          await tx.projectMembership.create({
            data: {
              projectId: project.id,
              userId,
              roleId: adminRole.id,
              roles: { create: [{ roleId: adminRole.id }] },
            },
          });
        }
        return project;
      });
    } catch (e) {
      // Khoá duy nhất [workspace, mã/tên] còn giữ cả dự án đã xoá mềm — báo rõ thay vì lỗi 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(
          `Mã hoặc tên dự án đã được dùng (có thể bởi một dự án đã xoá) — hãy chọn mã/tên khác`,
        );
      }
      throw e;
    }

    return this.toDto(project, 0);
  }

  /** Danh sách dự án; dự án đã lưu trữ bị ẩn trừ khi `includeArchived`. */
  async list(workspaceId: string, includeArchived = false): Promise<ProjectDto[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, ...(includeArchived ? {} : { archivedAt: null }) },
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
    if (!p) throw new NotFoundAppException('Dự án');
    return this.toDto(p, p._count.issues, p.lead);
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, name: true, archivedAt: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  /** Sửa tên / mô tả / người phụ trách / cách giao việc mặc định. Mã dự án không đổi được (đã nằm trong mã mọi công việc). */
  async update(
    workspaceId: string,
    projectId: string,
    userId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectDto> {
    const cur = await this.requireProject(workspaceId, projectId);
    assertNotArchived(cur.archivedAt);
    const data: Prisma.ProjectUncheckedUpdateInput = { updatedById: userId };
    if (input.name !== undefined && input.name !== cur.name) {
      const dup = await this.prisma.project.findFirst({
        where: { workspaceId, name: input.name, deletedAt: null, id: { not: projectId } },
        select: { id: true },
      });
      if (dup)
        throw new BusinessRuleException(
          `Tên dự án "${input.name}" đã được dùng trong không gian làm việc này — hãy chọn tên khác`,
        );
      data.name = input.name;
    }
    if (input.description !== undefined)
      data.description = input.description?.trim() ? input.description : null;
    if (input.defaultAssigneeMode !== undefined)
      data.defaultAssigneeMode = input.defaultAssigneeMode;
    if (input.leadId !== undefined) {
      if (input.leadId) {
        const member = await this.prisma.workspaceMembership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: input.leadId } },
          select: { id: true },
        });
        if (!member)
          throw new BusinessRuleException(
            'Người phụ trách phải là thành viên của không gian làm việc — hãy thêm họ vào không gian làm việc trước',
          );
      }
      data.leadId = input.leadId;
    }
    try {
      await this.prisma.project.update({ where: { id: projectId }, data, select: { id: true } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(
          'Tên dự án đã được dùng (có thể bởi một dự án đã xoá) — hãy chọn tên khác',
        );
      }
      throw e;
    }
    return this.getById(workspaceId, projectId);
  }

  /**
   * Quản trị dự án đặt sức khoẻ thủ công (ghi đè giá trị tự tính). Đặt mức thì bắt buộc có ghi chú vì người đọc cần
   * biết lý do PM khác số liệu; `health: null` = bỏ ghi đè và xoá cả ghi chú. Không tự hết hạn — FE hiện "đặt bởi X,
   * N ngày trước" để người đọc tự đánh giá độ cũ. Dự án lưu trữ là chỉ đọc.
   */
  async setHealth(
    workspaceId: string,
    projectId: string,
    userId: string,
    input: SetProjectHealthInput,
  ): Promise<ProjectHealthDto> {
    const cur = await this.requireProject(workspaceId, projectId);
    assertNotArchived(cur.archivedAt);
    let data: Prisma.ProjectUncheckedUpdateInput;
    if (input.health === null) {
      data = {
        healthOverride: null,
        healthNote: null,
        healthUpdatedAt: null,
        healthUpdatedById: null,
      };
    } else {
      const note = input.note?.trim();
      if (!note)
        throw new BusinessRuleException(
          'Hãy ghi chú lý do khi đặt sức khoẻ dự án thủ công — người xem cần biết vì sao khác số liệu tự tính',
        );
      data = {
        healthOverride: input.health,
        healthNote: note,
        healthUpdatedAt: new Date(),
        healthUpdatedById: userId,
      };
    }
    await this.prisma.project.update({ where: { id: projectId }, data, select: { id: true } });
    const dto = (await this.health.forProjects(workspaceId, [projectId])).get(projectId);
    if (!dto) throw new NotFoundAppException('Dự án');
    return dto;
  }

  /** Lưu trữ dự án: ẩn khỏi danh sách và chuyển sang chỉ đọc. Giữ `isArchived` đồng bộ cho các báo cáo cũ. */
  async archive(workspaceId: string, projectId: string, userId: string): Promise<ProjectDto> {
    await this.requireProject(workspaceId, projectId);
    // Có điều kiện archivedAt null: hai lần lưu trữ đồng thời không ghi đè mốc thời gian của nhau.
    const { count } = await this.prisma.project.updateMany({
      where: { id: projectId, workspaceId, deletedAt: null, archivedAt: null },
      data: { archivedAt: new Date(), isArchived: true, updatedById: userId },
    });
    if (count === 0) throw new BusinessRuleException('Dự án đã được lưu trữ từ trước');
    return this.getById(workspaceId, projectId);
  }

  async unarchive(workspaceId: string, projectId: string, userId: string): Promise<ProjectDto> {
    await this.requireProject(workspaceId, projectId);
    const { count } = await this.prisma.project.updateMany({
      where: { id: projectId, workspaceId, deletedAt: null, archivedAt: { not: null } },
      data: { archivedAt: null, isArchived: false, updatedById: userId },
    });
    if (count === 0) throw new BusinessRuleException('Dự án đang hoạt động, không cần khôi phục');
    return this.getById(workspaceId, projectId);
  }

  /** Xoá mềm dự án (chỉ admin workspace). Dữ liệu giữ nguyên; dự án biến mất khỏi mọi danh sách. */
  async remove(workspaceId: string, projectId: string, userId: string): Promise<{ success: true }> {
    await this.requireProject(workspaceId, projectId);
    const { count } = await this.prisma.project.updateMany({
      where: { id: projectId, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), updatedById: userId },
    });
    if (count === 0) throw new NotFoundAppException('Dự án');
    return { success: true };
  }

  private async getById(workspaceId: string, projectId: string): Promise<ProjectDto> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      include: { _count: { select: { issues: true } }, lead: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return this.toDto(p, p._count.issues, p.lead);
  }

  /** Đặt ảnh đại diện project (xoá ảnh cũ best-effort). Trả về ProjectDto đầy đủ. */
  async setAvatar(
    workspaceId: string,
    key: string,
    file: Express.Multer.File | undefined,
    req: Request,
  ): Promise<ProjectDto> {
    const prev = await this.prisma.project.findFirst({
      where: { workspaceId, key, deletedAt: null },
      select: { id: true, avatarUrl: true, archivedAt: true },
    });
    if (!prev) throw new NotFoundAppException('Dự án');
    assertNotArchived(prev.archivedAt);
    const avatarUrl = await this.media.saveAvatar(file, 'proj', req);
    await this.prisma.project.update({ where: { id: prev.id }, data: { avatarUrl } });
    await this.media.removeByUrl(prev.avatarUrl);
    return this.getByKey(workspaceId, key);
  }

  /** Gỡ ảnh đại diện project. */
  async clearAvatar(workspaceId: string, key: string): Promise<ProjectDto> {
    const prev = await this.prisma.project.findFirst({
      where: { workspaceId, key, deletedAt: null },
      select: { id: true, avatarUrl: true, archivedAt: true },
    });
    if (!prev) throw new NotFoundAppException('Dự án');
    assertNotArchived(prev.archivedAt);
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
    if (!project) throw new NotFoundAppException('Dự án');
    const [issueTypes, priorities, severities, resolutions] = await Promise.all([
      this.prisma.issueType.findMany({
        where: { workspaceId },
        orderBy: { hierarchyLevel: 'asc' },
        select: {
          id: true,
          name: true,
          key: true,
          color: true,
          iconUrl: true,
          isSubtask: true,
          hierarchyLevel: true,
        },
      }),
      this.prisma.priority.findMany({
        where: { workspaceId },
        orderBy: { rank: 'desc' },
        select: { id: true, name: true, color: true, rank: true, isDefault: true },
      }),
      this.prisma.severity.findMany({
        where: { workspaceId },
        orderBy: { rank: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          color: true,
          rank: true,
          isDefault: true,
        },
      }),
      this.prisma.resolution.findMany({
        where: { workspaceId },
        orderBy: { rank: 'asc' },
        select: { id: true, name: true, description: true, rank: true, isDefault: true },
      }),
    ]);
    return { projectId: project.id, issueTypes, priorities, severities, resolutions };
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
        ? ({
            id: lead.id,
            email: lead.email,
            displayName: lead.displayName,
            avatarUrl: lead.avatarUrl,
          } as ProjectDto['lead'])
        : null,
      avatarUrl: p.avatarUrl,
      defaultAssigneeMode: p.defaultAssigneeMode,
      isArchived: p.archivedAt !== null,
      archivedAt: iso(p.archivedAt),
      issueCount,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
