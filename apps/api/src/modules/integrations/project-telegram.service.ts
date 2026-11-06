import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, PERMISSIONS } from '@tirapro/types';
import { IntegrationType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../audit/audit.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacService } from '../rbac/rbac.service';
import { IntegrationsService } from './integrations.service';
import { LinkCodesService, type LinkCodeResult, type PollResult } from './link-codes.service';
import { TelegramPersonalService } from './telegram-personal.service';

/** Loại thông báo mà kênh Telegram thật sự nhận (các producer ở `IntegrationsService`). Danh sách rỗng = tất cả. */
export const CHANNEL_EVENT_TYPES = ['STATUS_CHANGED', 'ISSUE_UPDATED', 'COMMENT_ADDED'] as const;

export interface ManagedProject {
  id: string;
  key: string;
  name: string;
}

export interface ProjectChannelDto {
  id: string;
  title: string | null;
  events: string[];
  isEnabled: boolean;
}

/** Số dự án tính quyền song song mỗi lượt (quyền hiệu lực có cache Redis nhưng vẫn là một lần đọc/dự án). */
const PERMISSION_BATCH = 10;

/**
 * Kênh Telegram CỦA DỰ ÁN cho Project Admin: tái dùng `LinkCodesService`/`IntegrationsService` nhưng chỉ đụng
 * `IntegrationChannel` có `projectId` = dự án của route. Không tạo/sửa bot, không đụng kênh cấp tổ chức hay dự án khác.
 * Quyền `project:admin` của CHÍNH dự án do guard (`@ProjectRef`) kiểm ở controller.
 */
@Injectable()
export class ProjectTelegramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    private readonly linkCodes: LinkCodesService,
    private readonly personal: TelegramPersonalService,
  ) {}

  /**
   * Dự án mà người dùng là Project Admin (quản trị tổ chức: mọi dự án đang hoạt động) — để Cài đặt › Thông báo biết có hiện
   * mục "Kênh Telegram của dự án" không. Chỉ xét dự án người này THẤY (dự án riêng tư không là thành viên thì không lộ).
   */
  async managedProjects(userId: string, organizationId: string): Promise<ManagedProject[]> {
    const visible = await this.access.visibleWhere(userId, organizationId);
    const projects = await this.prisma.project.findMany({
      where: { organizationId, deletedAt: null, archivedAt: null, ...visible },
      select: { id: true, key: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (projects.length === 0) return [];
    if (await this.rbac.holdsOrganizationAdmin(userId, organizationId)) return projects;
    const out: ManagedProject[] = [];
    for (let i = 0; i < projects.length; i += PERMISSION_BATCH) {
      const batch = projects.slice(i, i + PERMISSION_BATCH);
      const perms = await Promise.all(
        batch.map((p) => this.rbac.getEffectivePermissions(userId, organizationId, p.id)),
      );
      batch.forEach((p, idx) => {
        if (perms[idx]!.has(PERMISSIONS.PROJECT_ADMIN)) out.push(p);
      });
    }
    return out;
  }

  /** Bot đã sẵn sàng chưa + các kênh đang gắn dự án này. */
  async overview(organizationId: string, projectId: string) {
    const resolved = await this.personal.resolveBot(organizationId);
    const channels = await this.prisma.integrationChannel.findMany({
      where: { organizationId, projectId, integration: { type: IntegrationType.TELEGRAM } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, events: true, isEnabled: true },
    });
    return {
      botReady: 'bot' in resolved,
      reason: 'reason' in resolved ? resolved.reason : null,
      botUsername: 'bot' in resolved ? resolved.bot.botUsername : null,
      eventTypes: [...CHANNEL_EVENT_TYPES],
      channels: channels satisfies ProjectChannelDto[],
    };
  }

  /** Mã gắn nhóm cho dự án này (hạn 15 phút như mã của quản trị tổ chức). */
  async createCode(
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<LinkCodeResult> {
    const resolved = await this.personal.resolveBot(organizationId);
    if ('reason' in resolved) {
      throw new BusinessRuleException(
        'Quản trị tổ chức cần cài bot Telegram ở Kết nối › Telegram trước',
      );
    }
    return this.linkCodes.createCode(
      organizationId,
      resolved.bot.integration.id,
      userId,
      projectId,
    );
  }

  /** Hỏi xem mã đã được gõ trong nhóm chưa. Mã phải do CHÍNH người này tạo cho ĐÚNG dự án này. */
  async poll(
    organizationId: string,
    projectId: string,
    userId: string,
    rawCode: string,
  ): Promise<PollResult> {
    const code = rawCode.trim().toUpperCase();
    const row = await this.prisma.channelLinkToken.findFirst({
      where: { token: code, organizationId, projectId, createdById: userId },
      select: { integrationId: true },
    });
    if (!row?.integrationId) return { status: 'expired' };
    return this.linkCodes.poll(organizationId, row.integrationId, code, projectId);
  }

  private async requireChannel(organizationId: string, projectId: string, channelId: string) {
    const channel = await this.prisma.integrationChannel.findFirst({
      where: { id: channelId, organizationId, projectId },
      select: { id: true, title: true, externalId: true, integrationId: true },
    });
    // Kênh của dự án khác / cấp tổ chức: 404 như không tồn tại.
    if (!channel) throw new NotFoundAppException('Kênh');
    return channel;
  }

  /** Đổi sự kiện nhận và/hoặc bật tắt. `events` rỗng = tất cả sự kiện. */
  async updateChannel(
    organizationId: string,
    projectId: string,
    channelId: string,
    patch: { events?: string[]; isEnabled?: boolean },
    actorId: string,
  ): Promise<ProjectChannelDto> {
    const channel = await this.requireChannel(organizationId, projectId, channelId);
    const events = patch.events ? [...new Set(patch.events)] : undefined;
    const updated = await this.prisma.integrationChannel.update({
      where: { id: channel.id },
      data: {
        ...(events ? { events } : {}),
        ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled } : {}),
      },
      select: { id: true, title: true, events: true, isEnabled: true },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.INTEGRATION_CHANNEL_UPDATED,
      entityType: 'integration_channel',
      entityId: channel.id,
      summary: `Sửa kênh Telegram "${channel.title ?? channel.externalId}" của dự án`,
      meta: { projectId, events: events ?? null, isEnabled: patch.isEnabled ?? null },
    });
    return updated;
  }

  async removeChannel(
    organizationId: string,
    projectId: string,
    channelId: string,
    actorId: string,
  ): Promise<{ success: true }> {
    const channel = await this.requireChannel(organizationId, projectId, channelId);
    return this.integrations.removeChannel(organizationId, channel.id, actorId);
  }
}
