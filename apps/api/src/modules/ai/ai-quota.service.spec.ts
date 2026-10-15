import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { AiQuotaService } from './ai-quota.service';

function make(used: { inputTokens: number | null; outputTokens: number | null }, quota = 1000) {
  const aggregate = vi.fn().mockResolvedValue({ _sum: used });
  const prisma = { aiGenerationLog: { aggregate } };
  const config = { get: vi.fn().mockReturnValue({ monthlyQuotaPerWorkspace: quota }) };
  const svc = new AiQuotaService(prisma as never, config as never);
  return { svc, aggregate };
}

describe('AiQuotaService.assertWithinQuota', () => {
  it('ném BusinessRuleException khi tổng token tháng này >= hạn mức', async () => {
    const { svc } = make({ inputTokens: 600, outputTokens: 400 });
    const err = await svc.assertWithinQuota('ws1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleException);
    expect((err as Error).message).toContain(
      'Không gian làm việc đã dùng hết hạn mức AI tháng này',
    );
  });

  it('cho qua khi còn dưới hạn mức', async () => {
    const { svc } = make({ inputTokens: 300, outputTokens: 200 });
    await expect(svc.assertWithinQuota('ws1')).resolves.toBeUndefined();
  });

  it('coi _sum null (chưa có log) là 0', async () => {
    const { svc } = make({ inputTokens: null, outputTokens: null });
    await expect(svc.assertWithinQuota('ws1')).resolves.toBeUndefined();
  });

  it('chỉ cộng log của đúng workspace, từ đầu tháng (UTC), chỉ call thành công', async () => {
    const { svc, aggregate } = make({ inputTokens: 1, outputTokens: 1 });
    await svc.assertWithinQuota('ws1');
    const arg = aggregate.mock.calls[0]![0];
    expect(arg.where.workspaceId).toBe('ws1');
    expect(arg.where.success).toBe(true);
    const since: Date = arg.where.createdAt.gte;
    expect(since.getUTCDate()).toBe(1);
    expect(since.getUTCHours()).toBe(0);
  });

  it('hạn mức <= 0 nghĩa là không giới hạn', async () => {
    const { svc, aggregate } = make({ inputTokens: 9e9, outputTokens: 9e9 }, 0);
    await expect(svc.assertWithinQuota('ws1')).resolves.toBeUndefined();
    expect(aggregate).not.toHaveBeenCalled();
  });
});
