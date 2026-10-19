import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';
import { renderTemplate } from './util';
import { claimBatchNotice } from './batch-notice';

/**
 * Gửi thông báo trong ứng dụng cho người/vai trò chỉ định. Đi qua `NotificationsService.publish` (chốt trung tâm):
 * người nhận KHÔNG xem được dự án của việc (dự án riêng tư) thì không được báo/đẩy realtime/gửi email; tôn trọng
 * cài đặt (ISSUE_UPDATED mặc định tắt nhưng quy tắc là yêu cầu tường minh nên `force`; người đã TẮT tường minh thì thắng)
 * và gộp thông báo cùng loại trong 60 giây. Nhánh `roles`: vai ở cấp workspace chỉ tính người xem được dự án của việc.
 */
export async function runNotify(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'notify' }>,
): Promise<ActionResult> {
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
      where: {
        projectId: ctx.issue.projectId,
        role: { name: { in: a.roles } },
        project: { workspaceId: ctx.workspaceId },
      },
      select: { userId: true },
    });
    for (const m of [...byWs, ...byProject]) recipients.add(m.userId);
  }
  // Chỉ người xem được dự án của việc (cả `userIds` lẫn `roles`) — dự án riêng tư không lộ khoá/tiêu đề ra ngoài.
  const visible = await ctx.deps.notifications.filterCanSee(
    [...recipients],
    ctx.workspaceId,
    ctx.issue.projectId,
  );
  if (!visible.length)
    throw new BusinessRuleException(
      'Không tìm thấy người nhận thông báo xem được công việc này trong không gian làm việc',
    );

  const message = await renderTemplate(ctx, a.message);
  if (ctx.dryRun) return `Sẽ gửi thông báo cho ${visible.length} người: ${message.slice(0, 200)}`;

  let sent = 0;
  for (const recipientId of visible) {
    // Sửa hàng loạt: chỉ việc ĐẦU TIÊN của lô gửi (kèm cỡ lô); các việc sau cùng quy tắc + người nhận bị gộp vào đó.
    if (ctx.batch && !claimBatchNotice(ctx.batch.id, ctx.rule.id, recipientId)) continue;
    sent++;
    const text = ctx.batch ? `${message} (sửa hàng loạt ${ctx.batch.size} việc)` : message;
    await ctx.deps.notifications.publish(
      {
        recipientId,
        workspaceId: ctx.workspaceId,
        type: 'ISSUE_UPDATED',
        issueId: ctx.issue.id,
        projectId: ctx.issue.projectId,
        actorId: ctx.actorId,
        payload: { key: ctx.issue.key, summary: text, automation: ctx.rule.name },
      },
      { force: true },
    );
  }
  if (ctx.batch && sent === 0)
    return `Đã gộp vào thông báo của lần sửa hàng loạt (${visible.length} người nhận)`;
  return `Đã gửi thông báo cho ${visible.length} người`;
}
