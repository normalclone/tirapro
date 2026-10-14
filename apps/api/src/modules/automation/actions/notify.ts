import { DOMAIN_EVENTS } from '@tirapro/types';
import type { Prisma } from '@prisma/client';
import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';
import { renderTemplate } from './util';

/** Gửi thông báo trong ứng dụng cho người/vai trò chỉ định (luôn gửi — đây là yêu cầu tường minh của quy tắc). */
export async function runNotify(ctx: ActionContext, a: Extract<RuleAction, { type: 'notify' }>): Promise<ActionResult> {
  const { prisma } = ctx.deps;
  const recipients = new Set<string>();

  if (a.userIds?.length) {
    const members = await prisma.workspaceMembership.findMany({
      where: { workspaceId: ctx.workspaceId, userId: { in: a.userIds } },
      select: { userId: true },
    });
    for (const m of members) recipients.add(m.userId);
  }
  if (a.roles?.length) {
    const byWs = await prisma.workspaceMembership.findMany({
      where: { workspaceId: ctx.workspaceId, role: { name: { in: a.roles } } },
      select: { userId: true },
    });
    const byProject = await prisma.projectMembership.findMany({
      where: { projectId: ctx.issue.projectId, role: { name: { in: a.roles } }, project: { workspaceId: ctx.workspaceId } },
      select: { userId: true },
    });
    for (const m of [...byWs, ...byProject]) recipients.add(m.userId);
  }
  if (!recipients.size) throw new BusinessRuleException('Không tìm thấy người nhận thông báo trong không gian làm việc này');

  const message = await renderTemplate(ctx, a.message);
  if (ctx.dryRun) return `Sẽ gửi thông báo cho ${recipients.size} người: ${message.slice(0, 200)}`;

  const payload: Prisma.InputJsonValue = { key: ctx.issue.key, summary: message, automation: ctx.rule.name };
  for (const recipientId of recipients) {
    const created = await prisma.notification.create({
      data: { recipientId, workspaceId: ctx.workspaceId, type: 'ISSUE_UPDATED', issueId: ctx.issue.id, actorId: ctx.actorId, payload },
    });
    ctx.deps.events.emit(DOMAIN_EVENTS.NOTIFICATION_CREATED, {
      recipientId,
      notification: {
        id: created.id, type: created.type, issueId: created.issueId, commentId: created.commentId, actorId: created.actorId,
        payload: created.payload, readAt: null, createdAt: created.createdAt.toISOString(),
      },
    });
  }
  return `Đã gửi thông báo cho ${recipients.size} người`;
}
