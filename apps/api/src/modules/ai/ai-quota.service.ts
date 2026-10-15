import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException } from '../../common/exceptions/app.exception';

/** Hạn mức token AI theo tháng cho từng không gian làm việc (cộng từ `AiGenerationLog`). */
@Injectable()
export class AiQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Ném BusinessRuleException khi tổng token (vào + ra) của tháng này (UTC) đã chạm hạn mức.
   * Hạn mức <= 0 = không giới hạn. Kiểm tra là best-effort: hai lời gọi song song cùng sát ngưỡng
   * có thể vượt ngưỡng một chút (chấp nhận được cho hạn mức mềm theo tháng).
   */
  async assertWithinQuota(workspaceId: string): Promise<void> {
    const quota =
      this.config.get<{ monthlyQuotaPerWorkspace?: number }>('ai')?.monthlyQuotaPerWorkspace ?? 0;
    if (quota <= 0) return;

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const agg = await this.prisma.aiGenerationLog.aggregate({
      where: { workspaceId, success: true, createdAt: { gte: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const used = (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
    if (used >= quota) {
      throw new BusinessRuleException(
        'Không gian làm việc đã dùng hết hạn mức AI tháng này. Hãy liên hệ quản trị viên để nâng hạn mức, hoặc thử lại vào đầu tháng sau.',
      );
    }
  }
}
