import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type SprintDto } from '@tirapro/types';
import type { CreateSprintInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';

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
    if (!project) throw new NotFoundAppException('Project');
    const last = await this.prisma.sprint.findFirst({ where: { projectId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
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
  }

  async start(workspaceId: string, sprintId: string): Promise<SprintDto> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    if (sprint.state !== 'FUTURE') throw new BusinessRuleException('Chỉ sprint FUTURE mới start được');
    const active = await this.prisma.sprint.findFirst({ where: { projectId: sprint.projectId, state: 'ACTIVE', deletedAt: null } });
    if (active) throw new BusinessRuleException('Đã có sprint đang ACTIVE; hoàn thành nó trước');

    const updated = await this.prisma.sprint.update({
      where: { id: sprintId },
      data: { state: 'ACTIVE', startDate: sprint.startDate ?? new Date() },
    });
    await this.snapshot(sprintId, 'START');
    this.events.emit(DOMAIN_EVENTS.SPRINT_STARTED, { sprintId, projectId: sprint.projectId });
    return this.toDto(updated);
  }

  async complete(workspaceId: string, sprintId: string): Promise<SprintDto> {
    const sprint = await this.requireSprint(workspaceId, sprintId);
    if (sprint.state !== 'ACTIVE') throw new BusinessRuleException('Chỉ sprint ACTIVE mới complete được');

    await this.snapshot(sprintId, 'CLOSE');
    // Đưa issue chưa Done về backlog (sprintId = null)
    await this.prisma.issue.updateMany({
      where: { sprintId, deletedAt: null, status: { category: { not: 'DONE' } } },
      data: { sprintId: null },
    });
    const updated = await this.prisma.sprint.update({
      where: { id: sprintId },
      data: { state: 'CLOSED', completeDate: new Date() },
    });
    this.events.emit(DOMAIN_EVENTS.SPRINT_COMPLETED, { sprintId, projectId: sprint.projectId });
    return this.toDto(updated);
  }

  private async snapshot(sprintId: string, kind: 'START' | 'DAILY' | 'SCOPE_CHANGE' | 'CLOSE') {
    const issues = await this.prisma.issue.findMany({
      where: { sprintId, deletedAt: null },
      select: { storyPoints: true, status: { select: { category: true } } },
    });
    const committedPoints = issues.reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const completedPoints = issues.filter((i) => i.status.category === 'DONE').reduce((a, i) => a + (i.storyPoints ?? 0), 0);
    const completedCount = issues.filter((i) => i.status.category === 'DONE').length;
    await this.prisma.sprintSnapshot.create({
      data: {
        sprintId, kind, snapshotAt: new Date(),
        committedPoints, completedPoints, remainingPoints: committedPoints - completedPoints,
        committedCount: issues.length, completedCount,
      },
    });
  }

  private async requireSprint(workspaceId: string, sprintId: string) {
    const s = await this.prisma.sprint.findFirst({ where: { id: sprintId, deletedAt: null, project: { workspaceId } } });
    if (!s) throw new NotFoundAppException('Sprint');
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
