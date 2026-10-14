import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type SprintDto } from '@tirapro/types';
import type { CreateSprintInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';

/** Số lần thử lại khi hai request tạo sprint tính trùng sequence. */
const SEQUENCE_RETRIES = 3;

@Injectable()
export class SprintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async listForProject(workspaceId: string, projectId: string): Promise<SprintDto[]> {
    const sprints = await this.prisma.sprint.findMany({
      where: { projectId, deletedAt: null, project: { workspaceId } },
      orderBy: [{ state: 'asc' }, { sequence: 'desc' }],
      include: { _count: { select: { issues: true } }, issues: { select: { storyPoints: true } } },
    });
    return sprints.map((s) => this.toDto(s, s._count.issues, s.issues.reduce((a, i) => a + (i.storyPoints ?? 0), 0)));
  }

  async create(workspaceId: string, projectId: string, input: CreateSprintInput): Promise<SprintDto> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundAppException('Dự án');
    // sequence = lớn nhất + 1; hai request đồng thời có thể tính trùng → unique [projectId, sequence]
    // chặn bản ghi trùng (P2002) và ta tính lại, tối đa 3 lần.
    for (let attempt = 1; ; attempt++) {
      const last = await this.prisma.sprint.findFirst({ where: { projectId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
      try {
        const sprint = await this.prisma.sprint.create({
          data: {
            projectId,
            boardId: input.boardId ?? null,
            name: input.name,
            goal: input.goal ?? null,
            sequence: (last?.sequence ?? 0) + 1,
            startDate: input.startDate ? new Date(input.startDate) : null,
            endDate: input.endDate ? new Date(input.endDate) : null,
          },
        });
        return this.toDto(sprint, 0, 0);
      } catch (e) {
        const isDup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!isDup || attempt >= SEQUENCE_RETRIES) {
          if (isDup) throw new BusinessRuleException('Nhiều người đang tạo sprint cùng lúc — hãy thử tạo lại sau vài giây');
          throw e;
        }
      }
    }
  }

  async start(workspaceId: string, sprintId: string): Promise<SprintDto> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Khoá dòng project để hai request start đồng thời trong cùng project phải xếp hàng.
      await tx.project.update({ where: { id: sprint.projectId }, data: { updatedAt: new Date() }, select: { id: true } });
      const active = await tx.sprint.findFirst({ where: { projectId: sprint.projectId, state: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (active) throw new BusinessRuleException('Đã có sprint đang ACTIVE; hoàn thành nó trước');
      // Chuyển trạng thái có điều kiện: chỉ thắng khi sprint vẫn còn FUTURE.
      const { count } = await tx.sprint.updateMany({
        where: { id: sprintId, state: 'FUTURE', deletedAt: null },
        data: { state: 'ACTIVE', startDate: sprint.startDate ?? new Date() },
      });
      if (count === 0) throw new BusinessRuleException('Chỉ sprint FUTURE mới start được');
      await this.snapshot(tx, sprintId, 'START');
      return tx.sprint.findUniqueOrThrow({ where: { id: sprintId } });
    });
    this.events.emit(DOMAIN_EVENTS.SPRINT_STARTED, { sprintId, projectId: sprint.projectId });
    return this.toDto(updated);
  }

  async complete(workspaceId: string, sprintId: string, actorId: string): Promise<SprintDto> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Chuyển trạng thái có điều kiện: hai lần complete đồng thời chỉ một lần thắng.
      const { count } = await tx.sprint.updateMany({
        where: { id: sprintId, state: 'ACTIVE', deletedAt: null },
        data: { state: 'CLOSED', completeDate: new Date() },
      });
      if (count === 0) throw new BusinessRuleException('Chỉ sprint ACTIVE mới complete được');

      await this.snapshot(tx, sprintId, 'CLOSE');
      // Đưa issue chưa Done về backlog (sprintId = null) và ghi lịch sử cho từng issue bị đẩy ra.
      const pushed = await tx.issue.findMany({
        where: { sprintId, deletedAt: null, status: { category: { not: 'DONE' } } },
        select: { id: true },
      });
      if (pushed.length) {
        const ids = pushed.map((i) => i.id);
        await tx.issue.updateMany({ where: { id: { in: ids }, sprintId }, data: { sprintId: null } });
        const occurredAt = new Date();
        await tx.issueHistory.createMany({
          data: ids.map((issueId) => ({
            issueId, projectId: sprint.projectId, sprintId, field: 'SPRINT' as const,
            oldValue: sprintId, newValue: null, actorId, occurredAt,
          })),
        });
      }
      return tx.sprint.findUniqueOrThrow({ where: { id: sprintId } });
    });
    this.events.emit(DOMAIN_EVENTS.SPRINT_COMPLETED, { sprintId, projectId: sprint.projectId });
    return this.toDto(updated);
  }

  private async snapshot(tx: Prisma.TransactionClient, sprintId: string, kind: 'START' | 'DAILY' | 'SCOPE_CHANGE' | 'CLOSE') {
    const issues = await tx.issue.findMany({
      where: { sprintId, deletedAt: null },
      select: { storyPoints: true, status: { select: { category: true } } },
    });
    const committedPoints = issues.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const completedPoints = issues.filter((i) => i.status.category === 'DONE').reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const completedCount = issues.filter((i) => i.status.category === 'DONE').length;
    await tx.sprintSnapshot.create({
      data: {
        sprintId, kind, snapshotAt: new Date(),
        committedPoints, completedPoints, remainingPoints: committedPoints - completedPoints,
        committedCount: issues.length, completedCount,
      },
    });
  }

  private async requireSprint(workspaceId: string, sprintId: string) {
    const s = await this.prisma.sprint.findFirst({ where: { id: sprintId, deletedAt: null, project: { workspaceId } } });
    if (!s) throw new NotFoundAppException('Đợt làm việc (sprint)');
    return s;
  }

  private toDto(
    s: { id: string; projectId: string; boardId: string | null; name: string; goal: string | null; state: string; startDate: Date | null; endDate: Date | null; completeDate: Date | null; sequence: number },
    issueCount?: number,
    totalPoints?: number,
  ): SprintDto {
    return {
      id: s.id, projectId: s.projectId, boardId: s.boardId, name: s.name, goal: s.goal,
      state: s.state as SprintDto['state'],
      startDate: s.startDate?.toISOString() ?? null,
      endDate: s.endDate?.toISOString() ?? null,
      completeDate: s.completeDate?.toISOString() ?? null,
      sequence: s.sequence, issueCount, totalPoints,
    };
  }
}
