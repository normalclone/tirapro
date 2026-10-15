import { VersionConflictException } from '../../../common/exceptions/app.exception';
import type { ActionContext } from './types';

/**
 * Chạy `fn` với issue mới nhất; nếu người khác sửa chen ngang (version lệch) thì đọc lại và thử lại tối đa 2 lần.
 * Quy tắc không được ghi đè thay đổi của người dùng — OCC của IssuesService vẫn là hàng rào cuối.
 */
export async function withFreshIssue<T>(
  ctx: ActionContext,
  fn: (version: number) => Promise<T>,
): Promise<T> {
  let issue = await ctx.reload();
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(issue.version);
    } catch (e) {
      if (e instanceof VersionConflictException && attempt < 2) {
        issue = await ctx.reload();
        continue;
      }
      throw e;
    }
  }
}

/** Thay `{{issue.key}} {{issue.summary}} {{actor.displayName}}` — một lượt, giá trị chèn vào không bị thay tiếp. */
export async function renderTemplate(ctx: ActionContext, template: string): Promise<string> {
  if (!template.includes('{{')) return template;
  const actor = template.includes('{{actor.displayName}}') ? await ctx.actorName() : '';
  return template.replace(
    /\{\{\s*(issue\.key|issue\.summary|actor\.displayName)\s*\}\}/g,
    (_m, name: string) => {
      if (name === 'issue.key') return ctx.issue.key;
      if (name === 'issue.summary') return ctx.issue.summary;
      return actor;
    },
  );
}
