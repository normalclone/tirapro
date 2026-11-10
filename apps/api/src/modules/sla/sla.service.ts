import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, PERMISSIONS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertCanManageInProject } from '../../common/project-manage';
import { requireProjectId } from '../../common/project-required';
import { assertProjectWritable } from '../../common/project-writable';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacService } from '../rbac/rbac.service';
import type { CreateSlaPolicyInput, UpdateSlaPolicyInput } from './sla.schemas';

/**
 * SLA cho service desk: chính sách theo (dự án, mức ưu tiên) → hạn phản hồi & hạn
 * giải quyết. Khi tạo issue sẽ tự gắn hạn; bình luận đầu tiên = đã phản hồi;
 * chuyển sang trạng thái DONE = đã giải quyết. Tính theo phút trôi (không lịch làm việc).
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly rbac: RbacService,
  ) {}

  // ───────────── Chính sách ─────────────

  /**
   * Chính sách SLA mà `viewerId` được thấy — luôn thuộc một dự án (không còn mặc định cấp tổ chức), nên chỉ gồm chính
   * sách của dự án người đó thấy: chính sách của dự án riêng tư người ngoài không thấy bị loại (tên chính sách/khoá/tên
   * dự án không lộ). `projectId` thu hẹp theo một dự án (bảng "Thời gian xử lý" của dự án).
   */
  async list(organizationId: string, viewerId: string, projectId?: string) {
    const visible = await this.access.visibleWhere(viewerId, organizationId);
    const rows = await this.prisma.slaPolicy.findMany({
      where: {
        organizationId,
        ...(projectId ? { projectId } : {}),
        project: { deletedAt: null, ...visible },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        priority: { select: { id: true, name: true, color: true } },
        project: { select: { id: true, key: true, name: true } },
      },
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

  async create(organizationId: string, dto: CreateSlaPolicyInput, viewerId: string) {
    const projectId = requireProjectId(dto.projectId, 'chính sách thời gian xử lý');
    await this.access.assertCanSee(viewerId, organizationId, projectId);
    await assertProjectWritable(this.prisma, projectId);
    await this.prisma.slaPolicy.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        projectId,
        priorityId: dto.priorityId ?? null,
        responseMins: dto.responseMins,
        resolveMins: dto.resolveMins,
        active: dto.active ?? true,
      },
    });
    return this.list(organizationId, viewerId);
  }

  async update(organizationId: string, id: string, dto: UpdateSlaPolicyInput, viewerId: string) {
    const found = await this.prisma.slaPolicy.findFirst({
      where: { id, organizationId },
      select: { id: true, projectId: true },
    });
    if (!found) throw new NotFoundAppException('Cam kết thời gian xử lý');
    // Chính sách của dự án riêng tư người gọi không thấy = không tồn tại; không gắn được sang dự án ẩn.
    await this.access.assertCanSee(
      viewerId,
      organizationId,
      found.projectId,
      'Cam kết thời gian xử lý',
    );
    await assertProjectWritable(this.prisma, found.projectId);
    // Đổi dự án: bắt buộc có dự án đích (không còn chính sách cấp tổ chức).
    const nextProjectId =
      dto.projectId !== undefined
        ? requireProjectId(dto.projectId, 'chính sách thời gian xử lý')
        : undefined;
    if (nextProjectId) {
      await this.access.assertCanSee(viewerId, organizationId, nextProjectId);
      await assertProjectWritable(this.prisma, nextProjectId);
      // Guard chỉ tính quyền ở dự án HIỆN TẠI của chính sách → chuyển sang dự án khác phải kiểm quyền Ở ĐÍCH.
      if (nextProjectId !== found.projectId)
        await assertCanManageInProject(
          this.rbac,
          viewerId,
          organizationId,
          nextProjectId,
          PERMISSIONS.SLA_MANAGE,
          'chính sách thời gian xử lý',
        );
    }
    await this.prisma.slaPolicy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && dto.name !== null ? { name: dto.name.trim() } : {}),
        ...(nextProjectId ? { projectId: nextProjectId } : {}),
        ...(dto.priorityId !== undefined ? { priorityId: dto.priorityId } : {}),
        ...(dto.responseMins !== undefined ? { responseMins: dto.responseMins } : {}),
        ...(dto.resolveMins !== undefined ? { resolveMins: dto.resolveMins } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return this.list(organizationId, viewerId);
  }

  async remove(organizationId: string, id: string, viewerId: string) {
    const found = await this.prisma.slaPolicy.findFirst({
      where: { id, organizationId },
      select: { projectId: true },
    });
    if (found) {
      await this.access.assertCanSee(
        viewerId,
        organizationId,
        found.projectId,
        'Cam kết thời gian xử lý',
      );
      await assertProjectWritable(this.prisma, found.projectId);
    }
    await this.prisma.slaPolicy.deleteMany({ where: { id, organizationId } });
    return { success: true };
  }

  // ───────────── Trạng thái SLA của issue ─────────────

  async getForIssue(organizationId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, organizationId, deletedAt: null },
      select: {
        id: true,
        resolvedAt: true,
        updatedAt: true,
        status: { select: { category: true } },
      },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    const row = await this.prisma.issueSla.findUnique({
      where: { issueId },
      include: { policy: { select: { name: true, responseMins: true, resolveMins: true } } },
    });
    if (!row) return null;
    const now = Date.now();
    // Việc đã ở trạng thái DONE mà dòng SLA chưa kịp đóng (đóng bằng đường không phát sự kiện, dữ liệu cũ…): coi là đã xong
    // vào lúc `resolvedAt` của việc — không để đồng hồ "còn N ngày" chạy tiếp trên việc đã xong (logbug #26).
    const doneAt =
      row.resolvedAt ??
      (issue.status.category === 'DONE' ? (issue.resolvedAt ?? issue.updatedAt) : null);
    return {
      policyName: row.policy.name,
      responseDueAt: row.responseDueAt.toISOString(),
      resolveDueAt: row.resolveDueAt.toISOString(),
      firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
      resolvedAt: doneAt?.toISOString() ?? null,
      responseBreached:
        row.responseBreached || (!row.firstRespondedAt && row.responseDueAt.getTime() < now),
      resolveBreached: doneAt
        ? doneAt.getTime() > row.resolveDueAt.getTime()
        : row.resolveDueAt.getTime() < now,
      responseRemainingMins: row.firstRespondedAt
        ? null
        : Math.round((row.responseDueAt.getTime() - now) / 60000),
      resolveRemainingMins: doneAt ? null : Math.round((row.resolveDueAt.getTime() - now) / 60000),
    };
  }

  /**
   * Danh sách issue đang có SLA (theo dõi vi phạm / sắp trễ) — chỉ việc của dự án `viewerId` thấy (khoá, tiêu đề,
   * người phụ trách của dự án riêng tư người ngoài không lộ).
   */
  async board(organizationId: string, viewerId: string, projectId?: string) {
    const visible = await this.access.visibleWhere(viewerId, organizationId);
    const rows = await this.prisma.issueSla.findMany({
      where: {
        issue: {
          organizationId,
          deletedAt: null,
          // Việc đã ở trạng thái DONE thì không còn "đang chạy đồng hồ", dù dòng SLA chưa được đóng (logbug #26).
          status: { category: { not: 'DONE' } },
          ...(projectId ? { projectId } : {}),
          ...(Object.keys(visible).length ? { project: { deletedAt: null, ...visible } } : {}),
        },
        resolvedAt: null,
      },
      orderBy: { resolveDueAt: 'asc' },
      take: 200,
      include: {
        policy: { select: { name: true } },
        issue: {
          select: {
            id: true,
            key: true,
            summary: true,
            status: { select: { name: true, category: true } },
            assignee: { select: { id: true, displayName: true, avatarUrl: true } },
            priority: { select: { name: true, color: true, rank: true } },
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
      responseBreached:
        r.responseBreached || (!r.firstRespondedAt && r.responseDueAt.getTime() < now),
      resolveBreached: r.resolveDueAt.getTime() < now,
    }));
  }

  // ───────────── Tự động gắn / cập nhật theo sự kiện ─────────────

  /**
   * Chọn chính sách khớp nhất CHỈ trong dự án của việc: ưu tiên đúng mức ưu tiên > chính sách dự án áp mọi mức. Không còn
   * mặc định cấp tổ chức — dự án không có chính sách thì việc không có đồng hồ SLA.
   */
  private async pickPolicy(organizationId: string, projectId: string, priorityId: string | null) {
    const candidates = await this.prisma.slaPolicy.findMany({
      where: { organizationId, projectId, active: true },
    });
    const matching = candidates.filter((p) => !p.priorityId || p.priorityId === priorityId);
    if (matching.length === 0) return null;
    const score = (p: (typeof candidates)[number]) =>
      priorityId && p.priorityId === priorityId ? 1 : 0;
    // Tie-break XÁC ĐỊNH (TIRA-BUG-30): nhiều cam kết cùng phạm vi (ví dụ hai cam kết "mọi mức ưu tiên"
    // cùng bật) thì không chọn ngẫu nhiên theo thứ tự DB — ưu tiên khớp đúng mức ưu tiên, rồi chọn cam kết
    // CHẶT NHẤT (hạn xử lý ngắn nhất → hạn phản hồi ngắn nhất), cuối cùng theo thời điểm tạo rồi id cho ổn định.
    return matching.sort(
      (a, b) =>
        score(b) - score(a) ||
        a.resolveMins - b.resolveMins ||
        a.responseMins - b.responseMins ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )[0]!;
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_CREATED)
  async onIssueCreated(payload: unknown): Promise<void> {
    try {
      const { issue } = payload as {
        issue: {
          id: string;
          organizationId: string;
          projectId: string;
          priority?: { id: string } | null;
          createdAt?: string | Date | null;
        };
      };
      if (!issue?.id) return;
      const policy = await this.pickPolicy(
        issue.organizationId,
        issue.projectId,
        issue.priority?.id ?? null,
      );
      if (!policy) return;
      // Đồng hồ chạy từ lúc công việc ĐƯỢC TẠO (như giao diện nói) — không phải lúc xử lý sự kiện (import/việc tạo trễ).
      const start = issue.createdAt ? new Date(issue.createdAt).getTime() : Date.now();
      const base = Number.isNaN(start) ? Date.now() : start;
      await this.prisma.issueSla.create({
        data: {
          issueId: issue.id,
          policyId: policy.id,
          responseDueAt: new Date(base + policy.responseMins * 60000),
          resolveDueAt: new Date(base + policy.resolveMins * 60000),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Gắn SLA khi tạo issue thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  async onCommentAdded(payload: unknown): Promise<void> {
    try {
      const { issueId } = payload as { issueId?: string };
      if (!issueId) return;
      const sla = await this.prisma.issueSla.findUnique({
        where: { issueId },
        select: { firstRespondedAt: true, responseDueAt: true },
      });
      if (!sla || sla.firstRespondedAt) return;
      const now = new Date();
      await this.prisma.issueSla.update({
        where: { issueId },
        data: { firstRespondedAt: now, responseBreached: now > sla.responseDueAt },
      });
    } catch (err) {
      this.logger.warn(
        `Cập nhật SLA phản hồi thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  async onIssueTransitioned(payload: unknown): Promise<void> {
    try {
      const { issue } = payload as { issue: { id: string; status?: { category?: string } | null } };
      if (!issue?.id) return;
      const sla = await this.prisma.issueSla.findUnique({
        where: { issueId: issue.id },
        select: { resolvedAt: true, resolveDueAt: true },
      });
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
        await this.prisma.issueSla.update({
          where: { issueId: issue.id },
          // Mở lại: bỏ mốc giải quyết VÀ cờ trễ cũ (nếu không việc mở lại còn hạn vẫn bị tô đỏ "quá hạn").
          data: { resolvedAt: null, resolveBreached: false },
        });
      }
    } catch (err) {
      this.logger.warn(
        `Cập nhật SLA giải quyết thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Đổi mức ưu tiên sau khi tạo → áp lại cam kết khớp mức mới (hạn tính lại từ lúc TẠO việc, giữ nguyên mốc phản hồi/giải
   * quyết đã có). Không đụng việc đã xong.
   */
  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  async onIssueUpdated(payload: unknown): Promise<void> {
    try {
      const { issue, changedFields } = payload as {
        issue?: {
          id: string;
          organizationId: string;
          projectId: string;
          createdAt?: string | Date | null;
          priority?: { id: string } | null;
        };
        changedFields?: string[];
      };
      if (!issue?.id || !changedFields?.includes('priorityId')) return;
      const sla = await this.prisma.issueSla.findUnique({
        where: { issueId: issue.id },
        select: { policyId: true, resolvedAt: true, firstRespondedAt: true },
      });
      if (!sla || sla.resolvedAt) return;
      const policy = await this.pickPolicy(
        issue.organizationId,
        issue.projectId,
        issue.priority?.id ?? null,
      );
      if (!policy || policy.id === sla.policyId) return;
      const start = issue.createdAt ? new Date(issue.createdAt).getTime() : Date.now();
      const base = Number.isNaN(start) ? Date.now() : start;
      const responseDueAt = new Date(base + policy.responseMins * 60000);
      await this.prisma.issueSla.update({
        where: { issueId: issue.id },
        data: {
          policyId: policy.id,
          responseDueAt,
          resolveDueAt: new Date(base + policy.resolveMins * 60000),
          resolveBreached: false,
          ...(sla.firstRespondedAt ? {} : { responseBreached: false }),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Áp lại SLA khi đổi ưu tiên thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
