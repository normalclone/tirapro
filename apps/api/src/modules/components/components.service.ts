import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, FixVersionType, VersionStatus } from '@tirapro/types';
import type { HistoryField } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertIssueWritable, assertProjectWritable } from '../../common/project-writable';
import { issueSetsSelect, mapIssueSets } from '../issues/issue-sets';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';

type ComponentRow = Prisma.ComponentGetPayload<true>;
type VersionRow = Prisma.VersionGetPayload<true>;

export interface ComponentDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  leadId: string | null;
}

export interface VersionDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: VersionStatus;
  startDate: string | null;
  releaseDate: string | null;
}

export interface CreateComponentInput {
  name: string;
  description?: string;
  leadId?: string;
}

export interface UpdateComponentInput {
  name?: string;
  description?: string;
  leadId?: string;
}

export interface CreateVersionInput {
  name: string;
  description?: string;
  status?: VersionStatus;
  startDate?: string;
  releaseDate?: string;
}

export interface UpdateVersionInput {
  name?: string;
  description?: string;
  status?: VersionStatus;
  startDate?: string;
  releaseDate?: string;
}

@Injectable()
export class ComponentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // ============================ COMPONENTS ==================================

  async listComponents(workspaceId: string, projectId: string): Promise<ComponentDto[]> {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.component.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toComponentDto(r));
  }

  async createComponent(
    workspaceId: string,
    projectId: string,
    input: CreateComponentInput,
  ): Promise<ComponentDto> {
    await this.requireProject(workspaceId, projectId);
    await assertProjectWritable(this.prisma, projectId);
    try {
      const row = await this.prisma.component.create({
        data: {
          projectId,
          name: input.name,
          description: input.description ?? null,
          leadId: input.leadId ?? null,
        },
      });
      return this.toComponentDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Component đã tồn tại');
      }
      throw e;
    }
  }

  async updateComponent(
    workspaceId: string,
    componentId: string,
    input: UpdateComponentInput,
  ): Promise<ComponentDto> {
    const cur = await this.requireComponent(workspaceId, componentId);
    await assertProjectWritable(this.prisma, cur.projectId);
    const data: Prisma.ComponentUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.leadId !== undefined) data.leadId = input.leadId;
    try {
      const row = await this.prisma.component.update({
        where: { id: componentId },
        data,
      });
      return this.toComponentDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Component đã tồn tại');
      }
      throw e;
    }
  }

  async removeComponent(workspaceId: string, componentId: string): Promise<{ success: true }> {
    const cur = await this.requireComponent(workspaceId, componentId);
    await assertProjectWritable(this.prisma, cur.projectId);
    await this.prisma.component.delete({ where: { id: componentId } });
    return { success: true };
  }

  async attachComponent(
    workspaceId: string,
    userId: string,
    issueId: string,
    componentId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    const component = await this.prisma.component.findFirst({
      where: { id: componentId, projectId: issue.projectId },
      select: { id: true, name: true },
    });
    if (!component) throw new NotFoundAppException('Hạng mục');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.issueComponent.create({ data: { issueId, componentId } });
        await this.recordSet(tx, userId, issue, 'COMPONENT', null, component.name);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    await this.emitSets(issueId);
    return { ok: true };
  }

  async detachComponent(
    workspaceId: string,
    userId: string,
    issueId: string,
    componentId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    const component = await this.prisma.component.findFirst({
      where: { id: componentId, projectId: issue.projectId },
      select: { name: true },
    });
    const removed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.issueComponent.deleteMany({ where: { issueId, componentId } });
      // Gỡ cái chưa gắn là idempotent: không để lại lịch sử, không phát sự kiện.
      if (count > 0)
        await this.recordSet(tx, userId, issue, 'COMPONENT', component?.name ?? componentId, null);
      return count > 0;
    });
    if (removed) await this.emitSets(issueId);
    return { ok: true };
  }

  // ============================ VERSIONS ====================================

  async listVersions(workspaceId: string, projectId: string): Promise<VersionDto[]> {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.version.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toVersionDto(r));
  }

  async createVersion(
    workspaceId: string,
    projectId: string,
    input: CreateVersionInput,
  ): Promise<VersionDto> {
    await this.requireProject(workspaceId, projectId);
    await assertProjectWritable(this.prisma, projectId);
    try {
      const row = await this.prisma.version.create({
        data: {
          projectId,
          name: input.name,
          description: input.description ?? null,
          status: input.status ?? VersionStatus.UNRELEASED,
          startDate: input.startDate ? new Date(input.startDate) : null,
          releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
        },
      });
      return this.toVersionDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Phiên bản đã tồn tại');
      }
      throw e;
    }
  }

  async updateVersion(
    workspaceId: string,
    versionId: string,
    input: UpdateVersionInput,
  ): Promise<VersionDto> {
    const cur = await this.requireVersion(workspaceId, versionId);
    await assertProjectWritable(this.prisma, cur.projectId);
    const data: Prisma.VersionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;
    if (input.startDate !== undefined) {
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    }
    if (input.releaseDate !== undefined) {
      data.releaseDate = input.releaseDate ? new Date(input.releaseDate) : null;
    }
    try {
      const row = await this.prisma.version.update({
        where: { id: versionId },
        data,
      });
      return this.toVersionDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Phiên bản đã tồn tại');
      }
      throw e;
    }
  }

  async removeVersion(workspaceId: string, versionId: string): Promise<{ success: true }> {
    const cur = await this.requireVersion(workspaceId, versionId);
    await assertProjectWritable(this.prisma, cur.projectId);
    await this.prisma.version.delete({ where: { id: versionId } });
    return { success: true };
  }

  async attachVersion(
    workspaceId: string,
    userId: string,
    issueId: string,
    versionId: string,
    type: FixVersionType,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    const version = await this.prisma.version.findFirst({
      where: { id: versionId, projectId: issue.projectId },
      select: { id: true, name: true },
    });
    if (!version) throw new NotFoundAppException('Phiên bản');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.issueFixVersion.create({ data: { issueId, versionId, type } });
        await this.recordSet(tx, userId, issue, 'FIX_VERSION', null, `${type}:${version.name}`);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    await this.emitSets(issueId);
    return { ok: true };
  }

  async detachVersion(
    workspaceId: string,
    userId: string,
    issueId: string,
    versionId: string,
    type: FixVersionType,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    const version = await this.prisma.version.findFirst({
      where: { id: versionId, projectId: issue.projectId },
      select: { name: true },
    });
    const removed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.issueFixVersion.deleteMany({
        where: { issueId, versionId, type },
      });
      if (count > 0)
        await this.recordSet(
          tx,
          userId,
          issue,
          'FIX_VERSION',
          `${type}:${version?.name ?? versionId}`,
          null,
        );
      return count > 0;
    });
    if (removed) await this.emitSets(issueId);
    return { ok: true };
  }

  /**
   * Lịch sử gắn/bỏ (oldValue = cái bị bỏ, newValue = cái được gắn). Phiên bản lưu `FIX:v1.0` / `AFFECTS:v1.0` để
   * FE phân biệt loại. Không đổi `version`/`updatedAt` của việc (giống nhãn) nên không có đường ghi nào khác.
   */
  private async recordSet(
    tx: Prisma.TransactionClient,
    userId: string,
    issue: { id: string; projectId: string; sprintId: string | null },
    field: HistoryField,
    oldValue: string | null,
    newValue: string | null,
  ): Promise<void> {
    await tx.issueHistory.create({
      data: {
        issueId: issue.id,
        projectId: issue.projectId,
        sprintId: issue.sprintId,
        actorId: userId,
        field,
        oldValue,
        newValue,
        occurredAt: new Date(),
      },
    });
  }

  /** Phát SAU commit: client thay thẳng tập thành phần/phiên bản theo id (không đổi `version` nên không qua issue:updated). */
  private async emitSets(issueId: string): Promise<void> {
    const row = await this.prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
      select: { id: true, key: true, projectId: true, ...issueSetsSelect },
    });
    if (!row) return;
    this.events.emit(DOMAIN_EVENTS.ISSUE_SETS_CHANGED, {
      issueId: row.id,
      issueKey: row.key,
      projectId: row.projectId,
      ...mapIssueSets(row),
    });
  }

  // ============================ SCOPE GUARDS ================================

  private async requireProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return project;
  }

  private async requireComponent(workspaceId: string, componentId: string) {
    const component = await this.prisma.component.findFirst({
      where: { id: componentId, project: { workspaceId, deletedAt: null } },
      select: { id: true, projectId: true },
    });
    if (!component) throw new NotFoundAppException('Hạng mục');
    return component;
  }

  private async requireVersion(workspaceId: string, versionId: string) {
    const version = await this.prisma.version.findFirst({
      where: { id: versionId, project: { workspaceId, deletedAt: null } },
      select: { id: true, projectId: true },
    });
    if (!version) throw new NotFoundAppException('Phiên bản');
    return version;
  }

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true, projectId: true, sprintId: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  // ============================ MAPPERS =====================================

  private toComponentDto(row: ComponentRow): ComponentDto {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      leadId: row.leadId,
    };
  }

  private toVersionDto(row: VersionRow): VersionDto {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      status: row.status,
      startDate: row.startDate ? row.startDate.toISOString() : null,
      releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
    };
  }
}
