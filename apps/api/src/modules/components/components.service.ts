import { Injectable } from '@nestjs/common';
import { FixVersionType, VersionStatus } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';

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
  constructor(private readonly prisma: PrismaService) {}

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
    await this.requireComponent(workspaceId, componentId);
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

  async removeComponent(
    workspaceId: string,
    componentId: string,
  ): Promise<{ success: true }> {
    await this.requireComponent(workspaceId, componentId);
    await this.prisma.component.delete({ where: { id: componentId } });
    return { success: true };
  }

  async attachComponent(
    workspaceId: string,
    issueId: string,
    componentId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    const component = await this.prisma.component.findFirst({
      where: { id: componentId, projectId: issue.projectId },
      select: { id: true },
    });
    if (!component) throw new NotFoundAppException('Component');
    try {
      await this.prisma.issueComponent.create({ data: { issueId, componentId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  async detachComponent(
    workspaceId: string,
    issueId: string,
    componentId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(workspaceId, issueId);
    try {
      await this.prisma.issueComponent.delete({
        where: { issueId_componentId: { issueId, componentId } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return { ok: true };
      }
      throw e;
    }
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
    await this.requireVersion(workspaceId, versionId);
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

  async removeVersion(
    workspaceId: string,
    versionId: string,
  ): Promise<{ success: true }> {
    await this.requireVersion(workspaceId, versionId);
    await this.prisma.version.delete({ where: { id: versionId } });
    return { success: true };
  }

  async attachVersion(
    workspaceId: string,
    issueId: string,
    versionId: string,
    type: FixVersionType,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    const version = await this.prisma.version.findFirst({
      where: { id: versionId, projectId: issue.projectId },
      select: { id: true },
    });
    if (!version) throw new NotFoundAppException('Phiên bản');
    try {
      await this.prisma.issueFixVersion.create({ data: { issueId, versionId, type } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  async detachVersion(
    workspaceId: string,
    issueId: string,
    versionId: string,
    type: FixVersionType,
  ): Promise<{ ok: true }> {
    await this.requireIssue(workspaceId, issueId);
    try {
      await this.prisma.issueFixVersion.delete({
        where: { issueId_versionId_type: { issueId, versionId, type } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
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
      where: { id: componentId, project: { workspaceId } },
      select: { id: true },
    });
    if (!component) throw new NotFoundAppException('Component');
    return component;
  }

  private async requireVersion(workspaceId: string, versionId: string) {
    const version = await this.prisma.version.findFirst({
      where: { id: versionId, project: { workspaceId } },
      select: { id: true },
    });
    if (!version) throw new NotFoundAppException('Phiên bản');
    return version;
  }

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundAppException('Issue');
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
      status: row.status as VersionStatus,
      startDate: row.startDate ? row.startDate.toISOString() : null,
      releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
    };
  }
}
