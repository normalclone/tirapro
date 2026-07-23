import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';

/** DTO trả về cho Severity (mức độ nghiêm trọng kỹ thuật). */
export interface SeverityDto {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  rank: number;
  isDefault: boolean;
  isSystem: boolean;
}

/** DTO trả về cho Priority (độ ưu tiên nghiệp vụ). */
export interface PriorityDto {
  id: string;
  name: string;
  iconKey: string | null;
  color: string | null;
  rank: number;
  isDefault: boolean;
  isSystem: boolean;
}

export interface CreateSeverityInput {
  name: string;
  description?: string;
  color?: string;
  rank?: number;
}

export interface UpdateSeverityInput {
  name?: string;
  description?: string;
  color?: string;
  rank?: number;
  isDefault?: boolean;
}

export interface CreatePriorityInput {
  name: string;
  iconKey?: string;
  color?: string;
  rank?: number;
}

export interface UpdatePriorityInput {
  name?: string;
  iconKey?: string;
  color?: string;
  rank?: number;
  isDefault?: boolean;
}

type SeverityRow = Prisma.SeverityGetPayload<true>;
type PriorityRow = Prisma.PriorityGetPayload<true>;

const SEVERITY_DUPLICATE = 'Mức độ đã tồn tại';
const PRIORITY_DUPLICATE = 'Độ ưu tiên đã tồn tại';
const SYSTEM_LOCKED = 'Không sửa được mục hệ thống';

@Injectable()
export class ConfigCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- Severities -----

  async listSeverities(workspaceId: string): Promise<SeverityDto[]> {
    const rows = await this.prisma.severity.findMany({
      where: { workspaceId },
      orderBy: { rank: 'desc' },
    });
    return rows.map((r) => this.toSeverityDto(r));
  }

  async createSeverity(
    workspaceId: string,
    input: CreateSeverityInput,
  ): Promise<SeverityDto> {
    try {
      const row = await this.prisma.severity.create({
        data: {
          workspaceId,
          name: input.name,
          description: input.description ?? null,
          color: input.color ?? null,
          rank: input.rank ?? 0,
        },
      });
      return this.toSeverityDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(SEVERITY_DUPLICATE);
      }
      throw e;
    }
  }

  async updateSeverity(
    workspaceId: string,
    id: string,
    input: UpdateSeverityInput,
  ): Promise<SeverityDto> {
    const existing = await this.requireSeverity(workspaceId, id);
    if (existing.isSystem) throw new BusinessRuleException(SYSTEM_LOCKED);

    const data: Prisma.SeverityUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.color !== undefined) data.color = input.color;
    if (input.rank !== undefined) data.rank = input.rank;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx.severity.updateMany({
            where: { workspaceId, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.severity.update({ where: { id }, data });
      });
      return this.toSeverityDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(SEVERITY_DUPLICATE);
      }
      throw e;
    }
  }

  async removeSeverity(
    workspaceId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.requireSeverity(workspaceId, id);
    if (existing.isSystem) throw new BusinessRuleException(SYSTEM_LOCKED);
    await this.prisma.severity.delete({ where: { id } });
    return { success: true };
  }

  // ----- Priorities -----

  async listPriorities(workspaceId: string): Promise<PriorityDto[]> {
    const rows = await this.prisma.priority.findMany({
      where: { workspaceId },
      orderBy: { rank: 'desc' },
    });
    return rows.map((r) => this.toPriorityDto(r));
  }

  async createPriority(
    workspaceId: string,
    input: CreatePriorityInput,
  ): Promise<PriorityDto> {
    try {
      const row = await this.prisma.priority.create({
        data: {
          workspaceId,
          name: input.name,
          iconKey: input.iconKey ?? null,
          color: input.color ?? null,
          rank: input.rank ?? 0,
        },
      });
      return this.toPriorityDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(PRIORITY_DUPLICATE);
      }
      throw e;
    }
  }

  async updatePriority(
    workspaceId: string,
    id: string,
    input: UpdatePriorityInput,
  ): Promise<PriorityDto> {
    const existing = await this.requirePriority(workspaceId, id);
    if (existing.isSystem) throw new BusinessRuleException(SYSTEM_LOCKED);

    const data: Prisma.PriorityUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.iconKey !== undefined) data.iconKey = input.iconKey;
    if (input.color !== undefined) data.color = input.color;
    if (input.rank !== undefined) data.rank = input.rank;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault === true) {
          await tx.priority.updateMany({
            where: { workspaceId, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.priority.update({ where: { id }, data });
      });
      return this.toPriorityDto(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException(PRIORITY_DUPLICATE);
      }
      throw e;
    }
  }

  async removePriority(
    workspaceId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.requirePriority(workspaceId, id);
    if (existing.isSystem) throw new BusinessRuleException(SYSTEM_LOCKED);
    await this.prisma.priority.delete({ where: { id } });
    return { success: true };
  }

  // ----- Helpers -----

  private async requireSeverity(
    workspaceId: string,
    id: string,
  ): Promise<SeverityRow> {
    const row = await this.prisma.severity.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundAppException('Mức độ');
    return row;
  }

  private async requirePriority(
    workspaceId: string,
    id: string,
  ): Promise<PriorityRow> {
    const row = await this.prisma.priority.findFirst({
      where: { id, workspaceId },
    });
    if (!row) throw new NotFoundAppException('Độ ưu tiên');
    return row;
  }

  private toSeverityDto(row: SeverityRow): SeverityDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      rank: row.rank,
      isDefault: row.isDefault,
      isSystem: row.isSystem,
    };
  }

  private toPriorityDto(row: PriorityRow): PriorityDto {
    return {
      id: row.id,
      name: row.name,
      iconKey: row.iconKey,
      color: row.color,
      rank: row.rank,
      isDefault: row.isDefault,
      isSystem: row.isSystem,
    };
  }
}
