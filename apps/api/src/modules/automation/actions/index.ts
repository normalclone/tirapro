import type { RuleAction } from '@tirapro/shared';
import { runAddComment } from './add-comment';
import { runCreateSubtask } from './create-subtask';
import { isPatchAction, runPatchBatch, type StepLog } from './issue-patch';
import { runLabel } from './labels';
import { runNotify } from './notify';
import { runTransition } from './transition';
import type { ActionContext } from './types';
import { runWebhook } from './webhook';

export type { ActionContext, ActionDeps } from './types';
export type { StepLog } from './issue-patch';

/**
 * Thực hiện danh sách action TUẦN TỰ. setField/assign liền nhau gộp thành một lần cập nhật (nguyên tử).
 * Dừng ở action lỗi đầu tiên: các bước trước đó đã áp dụng (mỗi bước là một thao tác độc lập — không có
 * rollback chéo giữa issue/comment/webhook), bước lỗi và các bước sau được ghi rõ trong log.
 * Trả `{ logs, failed }`; `failed` = true nếu có bước lỗi.
 */
export async function runActions(ctx: ActionContext, actions: RuleAction[]): Promise<{ logs: StepLog[]; failed: boolean }> {
  const logs: StepLog[] = [];
  let i = 0;
  while (i < actions.length) {
    const action = actions[i]!;
    let batch: Extract<RuleAction, { type: 'setField' | 'assign' }>[] = [];
    if (isPatchAction(action)) {
      while (i < actions.length && isPatchAction(actions[i]!)) batch.push(actions[i++] as never);
    } else {
      i++;
    }
    try {
      if (batch.length) {
        logs.push(...(await runPatchBatch(ctx, batch)));
        batch = [];
        continue;
      }
      logs.push({ step: action.type, ok: true, message: await runSingle(ctx, action) });
    } catch (e) {
      const message = errorMessage(e);
      if (batch.length) for (const b of batch) logs.push({ step: `${b.type}`, ok: false, message });
      else logs.push({ step: action.type, ok: false, message });
      const skipped = actions.length - i;
      if (skipped > 0) logs.push({ step: 'Dừng', ok: false, message: `Bỏ qua ${skipped} hành động còn lại do lỗi ở bước trước` });
      return { logs, failed: true };
    }
  }
  return { logs, failed: false };
}

function runSingle(ctx: ActionContext, a: RuleAction): Promise<string> {
  switch (a.type) {
    case 'transition': return runTransition(ctx, a);
    case 'addLabel':
    case 'removeLabel': return runLabel(ctx, a);
    case 'addComment': return runAddComment(ctx, a);
    case 'notify': return runNotify(ctx, a);
    case 'webhook': return runWebhook(ctx, a);
    case 'createSubtask': return runCreateSubtask(ctx, a);
    default: return Promise.reject(new Error(`Hành động không được hỗ trợ: ${(a as { type: string }).type}`));
  }
}

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, 500);
}
