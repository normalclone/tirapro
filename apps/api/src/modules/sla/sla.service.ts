import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import type { CreateSlaPolicyInput, UpdateSlaPolicyInput } from './sla.schemas';

/**
 * SLA cho service desk: chính sách theo (dự án, mức ưu tiên) → hạn phản hồi & hạn
 * giải quyết. Khi tạo issue sẽ tự gắn hạn; bình luận đầu tiên = đã phản hồi;
 * chuyển sang trạng thái DONE = đã giải quyết. Tính theo phút trôi (không lịch làm việc).
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────── Chính sách ─────────────

  async list(workspaceId: string) {
    const rows = await this.prisma.slaPolicy.findMany({
      where: { workspaceId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { priority: { select: { id: true, name: true, color: true } }, project: { select: { id: true, key: true, name: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      projectId: p.projectId,
      project: p.project,
      priorityId: p.priorityId,
      priority: p.priority,
      responseMins: p.responseMins,
      resolveMins: p.resolveMins,
      active: p.active,
    }));
  }

  async create(workspaceId: string, dto: CreateSlaPolicyInput) {
    await this.prisma.slaPolicy.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        projectId: dto.projectId ?? null,
        priorityId: dto.priorityId ?? null,
        responseMins: dto.responseMins,
        resolveMins: dto.resolveMins,
        active: dto.active ?? true,
      },
    });
    return this.list(workspaceId);
  }

  async update(workspaceId: string, id: string, dto: UpdateSlaPolicyInput) {
    const found = await this.prisma.slaPolicy.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!found) throw new NotFoundAppException('Cam kết thời gian xử lý');
    await this.prisma.slaPolicy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && dto.name !== null ? { name: dto.name.trim() } : {}),
        ...(dto.projectId !== undefined ? { projectId: dto.projectId } : {}),
        ...(dto.priorityId !== undefined ? { priorityId: dto.priorityId } : {}),
        ...(dto.responseMins !== undefined ? { responseMins: dto.responseMins } : {}),
        ...(dto.resolveMins !== undefined ? { resolveMins: dto.resolveMins } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return this.list(workspaceId);
  }

  async remove(workspaceId: string, id: string) {
    await this.prisma.slaPolicy.deleteMany({ where: { id, workspaceId } });
    return { success: true };
  }

  // ───────────── Trạng thái SLA của issue ─────────────

  async getForIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({ where: { id: issueId, workspaceId }, select: { id: true } });
    if (!issue) throw new NotFoundAppException('Công việc');
    const row = await this.prisma.issueSla.findUnique({
      where: { issueId },
      include: { policy: { select: { name: true, responseMins: true, resolveMins: true } } },
    });
    if (!row) return null;
    const now = Date.now();
    return {
      policyName: row.policy.name,
      responseDueAt: row.responseDueAt.toISOString(),
      resolveDueAt: row.resolveDueAt.toISOString(),
      firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      responseBreached: row.responseBreached || (!row.firstRespondedAt && row.responseDueAt.getTime() < now),
      resolveBreached: row.resolveBreached || (!row.resolvedAt && row.resolveDueAt.getTime() < now),
      responseRemainingMins: row.firstRespondedAt ? null : Math.round((row.responseDueAt.getTime() - now) / 60000),
      resolveRemainingMins: row.resolvedAt ? null : Math.round((row.resolveDueAt.getTime() - now) / 60000),
    };
  }

  /** Danh sách issue đang có SLA (theo dõi vi phạm / sắp trễ). */
  async board(workspaceId: string) {
    const rows = await this.prisma.issueSla.findMany({
      where: { issue: { workspaceId, deletedAt: null }, resolvedAt: null },
      orderBy: { resolveDueAt: 'asc' },
      take: 200,
      include: {
        policy: { select: { name: true } },
        issue: {
          select: {
            id: true, key: true, summary: true,
            status: { select: { name: true, category: true } },
            assignee: { select: { id: true, displayName: true, avatarUrl: true } },
            priority: { select: { name: true, color: true } },
          },
        },
      },
    });
    const now = Date.now();
    return rows.map((r) => ({
      issueId: r.issueId,
      key: r.issue.key,
      summary: r.issue.summary,
      status: r.issue.status,
      assignee: r.issue.assignee,
      priority: r.issue.priority,
      policyName: r.policy.name,
      resolveDueAt: r.resolveDueAt.toISOString(),
      remainingMins: Math.round((r.resolveDueAt.getTime() - now) / 60000),
      responded: !!r.firstRespondedAt,
      responseBreached: r.responseBreached || (!r.firstRespondedAt && r.responseDueAt.getTime() < now),
      resolveBreached: r.resolveBreached || r.resolveDueAt.getTime() < now,
    }));
  }

  // ───────────── Tự động gắn / cập nhật theo sự kiện ─────────────

  /** Chọn chính sách khớp nhất: ưu tiên (dự án + mức ưu tiên) > dự án > mức ưu tiên > chung. */
  private async pickPolicy(workspaceId: string, projectId: string, priorityId: string | null) {
    const candidates = await this.prisma.slaPolicy.findMany({
      where: {
        workspaceId,
        active: true,
        OR: [{ projectId }, { projectId: null }],
      },
    });
    const score = (p: (typeof candidates)[number]) =>
      (p.projectId === projectId ? 2 : 0) + (priorityId && p.priorityId === priorityId ? 1 : 0);
    const matching = candidates.filter((p) => !p.priorityId || p.priorityId === priorityId);
    if (matching.length === 0) return null;
    return matching.sort((a, b) => score(b) - score(a))[0]!;
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_CREATED)
  async onIssueCreated(payload: unknown): Promise<void> {
    try {
      const { issue } = payload as { issue: { id: string; workspaceId: string; projectId: string; priority?: { id: string } | null } };
      if (!issue?.id) return;
      const policy = await this.pickPolicy(issue.workspaceId, issue.projectId, issue.priority?.id ?? null);
      if (!policy) return;
      const now = Date.now();
      await this.prisma.issueSla.create({
        data: {
          issueId: issue.id,
          policyId: policy.id,
          responseDueAt: new Date(now + policy.responseMins * 60000),
          resolveDueAt: new Date(now + policy.resolveMins * 60000),
        },
      });
    } catch (err) {
      this.logger.warn(`Gắn SLA khi tạo issue thất bại: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  async onCommentAdded(payload: unknown): Promise<void> {
    try {
      const { issueId } = payload as { issueId?: string };
      if (!issueId) return;
      const sla = await this.prisma.issueSla.findUnique({ where: { issueId }, select: { firstRespondedAt: true, responseDueAt: true } });
      if (!sla || sla.firstRespondedAt) return;
      const now = new Date();
      await this.prisma.issueSla.update({
        where: { issueId },
        data: { firstRespondedAt: now, responseBreached: now > sla.responseDueAt },
      });
    } catch (err) {
      this.logger.warn(`Cập nhật SLA phản hồi thất bại: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  async onIssueTransitioned(payload: unknown): Promise<void> {
    try {
      const { issue } = payload as { issue: { id: string; status?: { category?: string } | null } };
      if (!issue?.id) return;
      const sla = await this.prisma.issueSla.findUnique({ where: { issueId: issue.id }, select: { resolvedAt: true, resolveDueAt: true } });
      if (!sla) return;
      const isDone = issue.status?.category === 'DONE';
      if (isDone && !sla.resolvedAt) {
        const now = new Date();
        await this.prisma.issueSla.update({
          where: { issueId: issue.id },
          data: { resolvedAt: now, resolveBreached: now > sla.resolveDueAt },
        });
      } else if (!isDone && sla.resolvedAt) {
        // Mở lại ticket → bỏ mốc giải quyết.
        await this.prisma.issueSla.update({ where: { issueId: issue.id }, data: { resolvedAt: null } });
      }
    } catch (err) {
      this.logger.warn(`Cập nhật SLA giải quyết thất bại: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
