import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';
import { withFreshIssue } from './util';

export async function runTransition(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'transition' }>,
): Promise<ActionResult> {
  // Quy trình theo loại việc: quy tắc có thể mang nhiều trạng thái đích (mỗi quy trình một cái) — chọn cái nằm cùng quy trình
  // với việc; không cái nào khớp thì dùng trạng thái chính (chuyển sẽ báo lỗi bước chuyển không hợp lệ, không im lặng).
  const candidates = [a.toStatusId, ...(a.alsoStatusIds ?? [])];
  const rows = await ctx.deps.prisma.status.findMany({
    where: { id: { in: candidates }, workflow: { workspaceId: ctx.workspaceId } },
    select: { id: true, name: true, workflowId: true },
  });
  const primary = rows.find((r) => r.id === a.toStatusId);
  const status =
    rows.find((r) => r.workflowId === ctx.issue.status.workflowId) ?? primary ?? rows[0];
  if (!status)
    throw new BusinessRuleException('Trạng thái đích không tồn tại — hãy chọn lại trong quy tắc');
  if (ctx.issue.status.id === status.id) return `Đã ở trạng thái "${status.name}" — bỏ qua`;
  if (ctx.dryRun) return `Sẽ chuyển sang "${status.name}"`;
  const updated = await withFreshIssue(ctx, (version) =>
    ctx.deps.issues.transition(
      ctx.workspaceId,
      ctx.actorId,
      ctx.issue.id,
      { toStatusId: status.id, version },
      ctx.meta,
    ),
  );
  ctx.issue = updated;
  return `Đã chuyển sang "${status.name}"`;
}
