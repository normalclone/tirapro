import type { RuleAction } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import { assertIssueWritable } from '../../../common/project-writable';
import type { ActionContext, ActionResult } from './types';

/**
 * Gắn/gỡ nhãn. Nhãn phải thuộc đúng dự án của issue. Luồng gắn nhãn hiện tại không phát sự kiện
 * (cùng hành vi với LabelsService) nên không kéo thêm vòng lặp.
 */
export async function runLabel(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'addLabel' | 'removeLabel' }>,
): Promise<ActionResult> {
  const { prisma } = ctx.deps;
  // Action ghi thẳng `issueLabel` (không qua service) nên tự chặn dự án lưu trữ — kể cả khi chạy thử.
  await assertIssueWritable(prisma, ctx.issue.id);
  const label = await prisma.label.findFirst({
    where: { id: a.labelId, projectId: ctx.issue.projectId },
    select: { id: true, name: true },
  });
  if (!label)
    throw new BusinessRuleException(
      'Nhãn không thuộc dự án của công việc này — hãy chọn lại nhãn trong quy tắc',
    );
  const has = ctx.issue.labels.some((l) => l.id === label.id);
  if (a.type === 'addLabel') {
    if (has) return `Đã có nhãn "${label.name}" — bỏ qua`;
    if (!ctx.dryRun)
      await prisma.issueLabel.createMany({
        data: [{ issueId: ctx.issue.id, labelId: label.id }],
        skipDuplicates: true,
      });
    return ctx.dryRun ? `Sẽ gắn nhãn "${label.name}"` : `Đã gắn nhãn "${label.name}"`;
  }
  if (!has) return `Không có nhãn "${label.name}" — bỏ qua`;
  if (!ctx.dryRun)
    await prisma.issueLabel.deleteMany({ where: { issueId: ctx.issue.id, labelId: label.id } });
  return ctx.dryRun ? `Sẽ gỡ nhãn "${label.name}"` : `Đã gỡ nhãn "${label.name}"`;
}
