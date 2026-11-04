import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { ActionContext, ActionResult } from './types';
import { WorkflowResolver } from '../../workflow-admin/workflow-resolver.service';
import { withFreshIssue } from './util';

/** Không giữ trạng thái (cache theo request/lần chạy nằm trong resolver) nên dùng chung một bản. */
const workflows = new WorkflowResolver();

export async function runTransition(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'transition' }>,
): Promise<ActionResult> {
  // Quy trình theo loại việc: quy tắc có thể mang nhiều trạng thái đích (mỗi quy trình một cái) — chọn cái nằm trong quy trình
  // của LOẠI việc (máy chủ kiểm bước chuyển theo quy trình này, nên việc đang ở trạng thái lệch quy trình vẫn có đích hợp lệ);
  // không khớp thì thử quy trình của trạng thái hiện tại, rồi trạng thái chính (chuyển sẽ báo lỗi, không im lặng).
  const { workflowId: typeWorkflowId } = await workflows.forIssue(
    ctx.deps.prisma,
    ctx.issue.projectId,
    ctx.issue.type.id,
  );
  const candidates = [a.toStatusId, ...(a.alsoStatusIds ?? [])];
  const rows = await ctx.deps.prisma.status.findMany({
    where: { id: { in: candidates }, workflow: { organizationId: ctx.organizationId } },
    select: { id: true, name: true, workflowId: true },
  });
  const primary = rows.find((r) => r.id === a.toStatusId);
  const status =
    (typeWorkflowId ? rows.find((r) => r.workflowId === typeWorkflowId) : undefined) ??
    rows.find((r) => r.workflowId === ctx.issue.status.workflowId) ??
    primary ??
    rows[0];
  if (!status)
    throw new BusinessRuleException('Trạng thái đích không tồn tại — hãy chọn lại trong quy tắc');
  if (ctx.issue.status.id === status.id) return `Đã ở trạng thái "${status.name}" — bỏ qua`;
  if (ctx.dryRun) return `Sẽ chuyển sang "${status.name}"`;
  const updated = await withFreshIssue(ctx, (version) =>
    ctx.deps.issues.transition(
      ctx.organizationId,
      ctx.actorId,
      ctx.issue.id,
      { toStatusId: status.id, version },
      ctx.meta,
    ),
  );
  ctx.issue = updated;
  return `Đã chuyển sang "${status.name}"`;
}
