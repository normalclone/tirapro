import type { UpdateIssueInput } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import type { RuleAction } from '@tirapro/shared';
import type { ActionContext } from './types';
import { withFreshIssue } from './util';

type PatchFields = Partial<
  Pick<UpdateIssueInput, 'priorityId' | 'assigneeId' | 'sprintId' | 'dueDate' | 'storyPoints'>
>;
export type PatchAction = Extract<RuleAction, { type: 'setField' | 'assign' }>;

export const isPatchAction = (a: RuleAction): a is PatchAction =>
  a.type === 'setField' || a.type === 'assign';

/** Người nhận phải là thành viên của workspace — chặn quy tắc gán nhầm người ngoài tenant. */
async function assertMember(ctx: ActionContext, userId: string): Promise<void> {
  const m = await ctx.deps.prisma.workspaceMembership.findFirst({
    where: { workspaceId: ctx.workspaceId, userId },
    select: { userId: true },
  });
  if (!m)
    throw new BusinessRuleException(
      'Người được giao không thuộc không gian làm việc này — hãy chọn lại trong quy tắc',
    );
}

/** Chọn người được giao theo `mode`. */
async function resolveAssignee(
  ctx: ActionContext,
  a: Extract<RuleAction, { type: 'assign' }>,
): Promise<string> {
  const { prisma } = ctx.deps;
  switch (a.mode) {
    case 'reporter': {
      if (!ctx.issue.reporterId)
        throw new BusinessRuleException('Công việc không có người báo cáo để giao lại');
      return ctx.issue.reporterId;
    }
    case 'lead': {
      const project = await prisma.project.findFirst({
        where: { id: ctx.issue.projectId, workspaceId: ctx.workspaceId, deletedAt: null },
        select: { leadId: true },
      });
      if (!project?.leadId)
        throw new BusinessRuleException(
          'Dự án chưa có trưởng dự án (lead) — hãy đặt lead hoặc đổi cách giao',
        );
      return project.leadId;
    }
    case 'user': {
      await assertMember(ctx, a.userId as string);
      return a.userId as string;
    }
    case 'roundRobin': {
      const members = await prisma.workspaceMembership.findMany({
        where: { workspaceId: ctx.workspaceId, user: { status: 'ACTIVE' } },
        select: { userId: true },
        orderBy: { userId: 'asc' },
      });
      if (!members.length)
        throw new BusinessRuleException('Không có thành viên nào để luân phiên giao việc');
      // Luân phiên theo số lần quy tắc đã chạy — không cần lưu trạng thái riêng. Đọc runCount mới (cache quy tắc có thể cũ).
      const rule = await prisma.automationRule.findUnique({
        where: { id: ctx.rule.id },
        select: { runCount: true },
      });
      return members[(rule?.runCount ?? 0) % members.length]!.userId;
    }
  }
}

/** Dịch một action sang phần vá issue + mô tả. */
async function toPatch(
  ctx: ActionContext,
  a: PatchAction,
): Promise<{ patch: PatchFields; label: string }> {
  if (a.type === 'assign') {
    const userId = await resolveAssignee(ctx, a);
    return { patch: { assigneeId: userId }, label: `assign ${a.mode}` };
  }
  switch (a.field) {
    case 'storyPoints':
      return {
        patch: { storyPoints: a.value === null ? null : Number(a.value) },
        label: 'setField storyPoints',
      };
    case 'dueDate':
      return {
        patch: { dueDate: a.value === null ? null : new Date(String(a.value)).toISOString() },
        label: 'setField dueDate',
      };
    case 'priorityId':
      return {
        patch: { priorityId: a.value === null ? null : String(a.value) },
        label: 'setField priorityId',
      };
    case 'sprintId':
      return {
        patch: { sprintId: a.value === null ? null : String(a.value) },
        label: 'setField sprintId',
      };
    case 'assigneeId': {
      if (a.value !== null) await assertMember(ctx, String(a.value));
      return {
        patch: { assigneeId: a.value === null ? null : String(a.value) },
        label: 'setField assigneeId',
      };
    }
  }
}

const sameValue = (
  field: keyof PatchFields,
  patchValue: unknown,
  issue: ActionContext['issue'],
): boolean => {
  if (field === 'dueDate') {
    const cur = issue.dueDate ? new Date(issue.dueDate).getTime() : null;
    const next = patchValue ? new Date(patchValue as string).getTime() : null;
    return cur === next;
  }
  const current = field === 'priorityId' ? issue.priority?.id : issue[field];
  return (current ?? null) === (patchValue ?? null);
};

export interface StepLog {
  step: string;
  ok: boolean;
  message: string;
}

/**
 * Gộp các action setField/assign LIỀN NHAU thành MỘT lần `issues.update` (một transaction, một version, một sự kiện):
 * hoặc đổi hết hoặc không đổi gì. Trường đã đúng giá trị thì bỏ qua — đây cũng là chốt chặn vòng lặp
 * "quy tắc đặt A → sự kiện → quy tắc đặt A" (không còn gì để đổi thì không phát sự kiện).
 */
export async function runPatchBatch(
  ctx: ActionContext,
  actions: PatchAction[],
): Promise<StepLog[]> {
  const patch: PatchFields = {};
  const logs: StepLog[] = [];
  for (const a of actions) {
    const r = await toPatch(ctx, a); // lỗi ở bất kỳ action nào → ném, cả lô chưa ghi gì
    Object.assign(patch, r.patch);
    logs.push({ step: r.label, ok: true, message: '' });
  }
  const changed = (Object.keys(patch) as Array<keyof PatchFields>).filter(
    (f) => !sameValue(f, patch[f], ctx.issue),
  );
  const note = changed.length
    ? `đổi ${changed.join(', ')}`
    : 'không có gì cần đổi (đã đúng giá trị)';
  for (const l of logs)
    l.message =
      ctx.dryRun && changed.length ? `Sẽ ${note}` : note[0]!.toUpperCase() + note.slice(1);
  if (!changed.length || ctx.dryRun) return logs;

  const updated = await withFreshIssue(ctx, (version) => {
    const body: UpdateIssueInput = { version };
    for (const f of changed) Object.assign(body, { [f]: patch[f] });
    return ctx.deps.issues.update(ctx.workspaceId, ctx.actorId, ctx.issue.id, body, ctx.meta);
  });
  ctx.issue = updated;
  return logs;
}
