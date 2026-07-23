import { Injectable } from '@nestjs/common';
import type { BoardDto } from '@tirapro/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';

const boardInclude = {
  columns: { include: { statuses: true }, orderBy: { order: 'asc' } },
} satisfies Prisma.BoardInclude;

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForProject(workspaceId: string, projectId: string): Promise<BoardDto[]> {
    const boards = await this.prisma.board.findMany({
      where: { projectId, deletedAt: null, project: { workspaceId } },
      include: boardInclude,
      orderBy: { createdAt: 'asc' },
    });
    return boards.map((b) => this.toDto(b));
  }

  async get(workspaceId: string, boardId: string): Promise<BoardDto> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null, project: { workspaceId } },
      include: boardInclude,
    });
    if (!board) throw new NotFoundAppException('Board');
    return this.toDto(board);
  }

  private toDto(b: Prisma.BoardGetPayload<{ include: typeof boardInclude }>): BoardDto {
    return {
      id: b.id,
      projectId: b.projectId,
      name: b.name,
      type: b.type,
      filterJql: b.filterJql,
      columns: b.columns.map((c) => ({
        id: c.id,
        boardId: c.boardId,
        name: c.name,
        order: c.order,
        wipLimit: c.wipLimit,
        statusIds: c.statuses.map((s) => s.statusId),
      })),
    };
  }
}
