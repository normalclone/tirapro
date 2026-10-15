import type { RuleAction } from '@tirapro/shared';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';
import { renderTemplate } from './util';

export async function runCreateSubtask(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'createSubtask' }>,
): Promise<ActionResult> {
  const type = await ctx.deps.prisma.issueType.findFirst({
    where: { id: a.typeId, workspaceId: ctx.workspaceId },
    select: { name: true, isSubtask: true },
  });
  if (!type) throw new NotFoundAppException('Loại công việc');
  if (!type.isSubtask)
    throw new BusinessRuleException(
      `Loại "${type.name}" không phải sub-task — hãy chọn một loại sub-task trong quy tắc`,
    );
  const summary = (await renderTemplate(ctx, a.summary)).slice(0, 255);
  if (ctx.dryRun) return `Sẽ tạo sub-task "${summary}"`;
  const created = await ctx.deps.issues.create(
    ctx.workspaceId,
    ctx.actorId,
    {
      projectId: ctx.issue.projectId,
      typeId: a.typeId,
      summary,
      parentId: ctx.issue.id,
      descriptionFormat: 'MARKDOWN',
    },
    ctx.meta,
  );
  return `Đã tạo sub-task ${created.key}`;
}
