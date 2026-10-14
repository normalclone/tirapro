import type { RuleAction } from '@tirapro/shared';
import type { ActionContext, ActionResult } from './types';
import { renderTemplate } from './util';

export async function runAddComment(ctx: ActionContext, a: Extract<RuleAction, { type: 'addComment' }>): Promise<ActionResult> {
  const body = await renderTemplate(ctx, a.body);
  if (ctx.dryRun) return `Sẽ bình luận: ${body.slice(0, 200)}`;
  await ctx.deps.comments.create(
    ctx.workspaceId, ctx.actorId, ctx.issue.id,
    { body, bodyFormat: 'MARKDOWN', parentId: null, mentionUserIds: [] },
    ctx.meta,
  );
  return 'Đã thêm bình luận';
}
