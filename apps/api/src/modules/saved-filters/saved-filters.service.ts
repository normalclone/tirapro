import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseJql, JqlParseError, FilterVisibility, type IssueDto } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SearchService } from '../search/search.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import type { PageResult } from '../../common/dto/page-result';

/** Dữ liệu trả về cho FE (đã rút gọn, kèm cờ isOwner). */
export interface SavedFilterDto {
  id: string;
  name: string;
  jql: string;
  visibility: FilterVisibility;
  sharedProjectId: string | null;
  ownerId: string;
  isOwner: boolean;
  createdAt: string;
}

export interface CreateSavedFilterInput {
  name: string;
  jql: string;
  visibility?: FilterVisibility;
  sharedProjectId?: string | null;
}

export interface UpdateSavedFilterInput {
  name?: string;
  jql?: string;
  visibility?: FilterVisibility;
  sharedProjectId?: string | null;
}

export interface RunSavedFilterOptions {
  cursor?: string;
  limit: number;
}

const filterSelect = {
  id: true,
  name: true,
  jql: true,
  visibility: true,
  sharedProjectId: true,
  ownerId: true,
  createdAt: true,
} satisfies Prisma.SavedFilterSelect;

type SavedFilterRow = Prisma.SavedFilterGetPayload<{ select: typeof filterSelect }>;

@Injectable()
export class SavedFiltersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {}

  /** Liệt kê filter mà user xem được trong workspace: của mình HOẶC WORKSPACE HOẶC PROJECT. */
  async list(workspaceId: string, userId: string): Promise<SavedFilterDto[]> {
    const rows = await this.prisma.savedFilter.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        OR: this.visibilityScope(userId),
      },
      select: filterSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r, userId));
  }

  /** Tạo filter mới — validate JQL trước, ownerId = user hiện tại. */
  async create(workspaceId: string, userId: string, input: CreateSavedFilterInput): Promise<SavedFilterDto> {
    this.validateJql(input.jql);
    const row = await this.prisma.savedFilter.create({
      data: {
        workspaceId,
        ownerId: userId,
        name: input.name,
        jql: input.jql,
        visibility: input.visibility ?? FilterVisibility.PRIVATE,
        sharedProjectId: input.sharedProjectId ?? null,
      },
      select: filterSelect,
    });
    return this.toDto(row, userId);
  }

  /** Cập nhật — chỉ chủ sở hữu; re-validate JQL nếu đổi. */
  async update(workspaceId: string, userId: string, id: string, input: UpdateSavedFilterInput): Promise<SavedFilterDto> {
    await this.requireOwned(workspaceId, userId, id);
    if (input.jql !== undefined) this.validateJql(input.jql);

    const data: Prisma.SavedFilterUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.jql !== undefined) data.jql = input.jql;
    if (input.visibility !== undefined) data.visibility = input.visibility;
    if (input.sharedProjectId !== undefined) data.sharedProjectId = input.sharedProjectId;

    const row = await this.prisma.savedFilter.update({
      where: { id },
      data,
      select: filterSelect,
    });
    return this.toDto(row, userId);
  }

  /** Xóa mềm — chỉ chủ sở hữu. */
  async softDelete(workspaceId: string, userId: string, id: string): Promise<{ success: true }> {
    await this.requireOwned(workspaceId, userId, id);
    await this.prisma.savedFilter.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** Chạy filter: nạp (phải xem được) rồi ủy quyền cho SearchService chạy JQL. */
  async run(workspaceId: string, userId: string, id: string, opts: RunSavedFilterOptions): Promise<PageResult<IssueDto>> {
    const filter = await this.requireVisible(workspaceId, userId, id);
    return this.search.search(workspaceId, userId, { jql: filter.jql, cursor: opts.cursor, limit: opts.limit });
  }

  /** Điều kiện OR cho phạm vi xem: của mình / WORKSPACE / PROJECT. */
  private visibilityScope(userId: string): Prisma.SavedFilterWhereInput[] {
    return [
      { ownerId: userId },
      { visibility: FilterVisibility.WORKSPACE },
      { visibility: FilterVisibility.PROJECT },
    ];
  }

  /** Nạp filter user xem được (của mình / WORKSPACE / PROJECT) — nếu không có thì 404. */
  private async requireVisible(workspaceId: string, userId: string, id: string): Promise<SavedFilterRow> {
    const row = await this.prisma.savedFilter.findFirst({
      where: {
        id,
        workspaceId,
        deletedAt: null,
        OR: this.visibilityScope(userId),
      },
      select: filterSelect,
    });
    if (!row) throw new NotFoundAppException('Bộ lọc');
    return row;
  }

  /** Nạp filter và đảm bảo user là chủ sở hữu (cho mutate) — 404 nếu không tồn tại, 403 nếu không phải chủ. */
  private async requireOwned(workspaceId: string, userId: string, id: string): Promise<SavedFilterRow> {
    const row = await this.prisma.savedFilter.findFirst({
      where: { id, workspaceId, deletedAt: null },
      select: filterSelect,
    });
    if (!row) throw new NotFoundAppException('Bộ lọc');
    if (row.ownerId !== userId) throw new ForbiddenAppException('Chỉ chủ sở hữu mới sửa được bộ lọc này');
    return row;
  }

  /** Validate cú pháp JQL; ném BusinessRuleException kèm message + vị trí khi sai. */
  private validateJql(jql: string): void {
    try {
      parseJql(jql);
    } catch (e) {
      if (e instanceof JqlParseError) {
        throw new BusinessRuleException(`JQL không hợp lệ: ${e.message} (vị trí ${e.position})`);
      }
      throw e;
    }
  }

  private toDto(row: SavedFilterRow, userId: string): SavedFilterDto {
    return {
      id: row.id,
      name: row.name,
      jql: row.jql,
      visibility: row.visibility,
      sharedProjectId: row.sharedProjectId,
      ownerId: row.ownerId,
      isOwner: row.ownerId === userId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
