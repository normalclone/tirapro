import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';
import { withFreshIssue } from './util';

export async function runTransition(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'transition' }>,
): Promise<ActionResult> {
  const status = await ctx.deps.prisma.status.findFirst({
    where: { id: a.toStatusId, workflow: { workspaceId: ctx.workspaceId } },
    select: { name: true },
  });
  if (!status)
    throw new BusinessRuleException('Trạng thái đích không tồn tại — hãy chọn lại trong quy tắc');
  if (ctx.issue.status.id === a.toStatusId) return `Đã ở trạng thái "${status.name}" — bỏ qua`;
  if (ctx.dryRun) return `Sẽ chuyển sang "${status.name}"`;
  const updated = await withFreshIssue(ctx, (version) =>
    ctx.deps.issues.transition(
      ctx.workspaceId,
      ctx.actorId,
      ctx.issue.id,
      { toStatusId: a.toStatusId, version },
      ctx.meta,
    ),
  );
  ctx.issue = updated;
  return `Đã chuyển sang "${status.name}"`;
}
