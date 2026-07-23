import { Injectable } from '@nestjs/common';
import { LabelDto } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';

export interface CreateLabelInput {
  name: string;
  color?: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

type LabelRow = Prisma.LabelGetPayload<true>;

@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, projectId: string): Promise<LabelDto[]> {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.label.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    workspaceId: string,
    projectId: string,
    input: CreateLabelInput,
  ): Promise<LabelDto> {
    await this.requireProject(workspaceId, projectId);
    try {
      const row = await this.prisma.label.create({
        data: { projectId, name: input.name, color: input.color ?? null },
      });
      return this.toDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Nhãn đã tồn tại trong dự án');
      }
      throw e;
    }
  }

  async update(
    workspaceId: string,
    labelId: string,
    input: UpdateLabelInput,
  ): Promise<LabelDto> {
    await this.requireLabel(workspaceId, labelId);
    const data: Prisma.LabelUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.color !== undefined) data.color = input.color;
    try {
      const row = await this.prisma.label.update({ where: { id: labelId }, data });
      return this.toDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Nhãn đã tồn tại trong dự án');
      }
      throw e;
    }
  }

  async remove(workspaceId: string, labelId: string): Promise<{ success: true }> {
    await this.requireLabel(workspaceId, labelId);
    await this.prisma.label.delete({ where: { id: labelId } });
    return { success: true };
  }

  async attach(
    workspaceId: string,
    issueId: string,
    labelId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireIssue(workspaceId, issueId);
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, projectId: issue.projectId },
      select: { id: true },
    });
    if (!label) throw new NotFoundAppException('Nhãn');
    try {
      await this.prisma.issueLabel.create({ data: { issueId, labelId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  async detach(
    workspaceId: string,
    issueId: string,
    labelId: string,
  ): Promise<{ ok: true }> {
    await this.requireIssue(workspaceId, issueId);
    try {
      await this.prisma.issueLabel.delete({
        where: { issueId_labelId: { issueId, labelId } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return { ok: true };
      }
      throw e;
    }
    return { ok: true };
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return project;
  }

  private async requireLabel(workspaceId: string, labelId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, project: { workspaceId } },
      select: { id: true },
    });
    if (!label) throw new NotFoundAppException('Nhãn');
    return label;
  }

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }

  private toDto(row: LabelRow): LabelDto {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      color: row.color,
    };
  }
}
