import { Injectable } from '@nestjs/common';
import { LabelDto } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertIssueWritable, assertProjectWritable } from '../../common/project-writable';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';

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

  async list(organizationId: string, projectId: string): Promise<LabelDto[]> {
    await this.requireProject(organizationId, projectId);
    const rows = await this.prisma.label.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    organizationId: string,
    projectId: string,
    input: CreateLabelInput,
  ): Promise<LabelDto> {
    await this.requireProject(organizationId, projectId);
    await assertProjectWritable(this.prisma, projectId);
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
    organizationId: string,
    labelId: string,
    input: UpdateLabelInput,
  ): Promise<LabelDto> {
    const cur = await this.requireLabel(organizationId, labelId);
    await assertProjectWritable(this.prisma, cur.projectId);
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

  async remove(organizationId: string, labelId: string): Promise<{ success: true }> {
    const cur = await this.requireLabel(organizationId, labelId);
    await assertProjectWritable(this.prisma, cur.projectId);
    await this.prisma.label.delete({ where: { id: labelId } });
    return { success: true };
  }

  async attach(organizationId: string, issueId: string, labelId: string): Promise<{ ok: true }> {
    const issue = await this.requireIssue(organizationId, issueId);
    await assertIssueWritable(this.prisma, issueId);
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

  async detach(organizationId: string, issueId: string, labelId: string): Promise<{ ok: true }> {
    await this.requireIssue(organizationId, issueId);
    await assertIssueWritable(this.prisma, issueId);
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

  private async requireProject(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return project;
  }

  private async requireLabel(organizationId: string, labelId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, project: { organizationId, deletedAt: null } },
      select: { id: true, projectId: true },
    });
    if (!label) throw new NotFoundAppException('Nhãn');
    return label;
  }

  private async requireIssue(organizationId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, organizationId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
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
