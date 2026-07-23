import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';

const DAY = 86_400_000;

/** Số liệu tổng quan toàn hệ thống cho admin console. */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly settings: SystemSettingsService,
  ) {}

  /** Trạng thái degrade các phụ thuộc (đúng nguyên tắc degrade-graceful). */
  async degrade() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const provider = this.config.get<string>('embedding.provider') ?? 'none';
    const embKey =
      provider === 'voyage' ? this.config.get<string>('embedding.voyageApiKey')
      : provider === 'openai' ? this.config.get<string>('embedding.openaiApiKey')
      : '';
    const aiConfigured = !!this.config.get<boolean>('ai.enabled') && !!this.config.get<string>('ai.anthropicApiKey');
    const storageDriver = this.config.get<string>('storage.driver') ?? 'local';
    return {
      db,
      redis: this.redis.isAvailable(),
      ai: aiConfigured && !this.settings.flags().aiKillSwitch,
      aiConfigured,
      embedding: provider !== 'none' && !!embKey,
      embeddingProvider: provider,
      storage: storageDriver === 'local' ? true : !!this.config.get<string>('storage.s3.bucket'),
      storageDriver,
    };
  }

  /** Ảnh chụp cấu hình (env-derived) + cờ runtime — cho màn Cấu hình & Feature flags. */
  configStatus() {
    const c = this.config;
    const provider = c.get<string>('embedding.provider') ?? 'none';
    const embKey =
      provider === 'voyage' ? c.get<string>('embedding.voyageApiKey')
      : provider === 'openai' ? c.get<string>('embedding.openaiApiKey')
      : '';
    return {
      nodeEnv: c.get<string>('nodeEnv') ?? 'development',
      ai: {
        enabled: !!c.get<boolean>('ai.enabled'),
        hasKey: !!c.get<string>('ai.anthropicApiKey'),
        modelPrimary: c.get<string>('ai.modelPrimary') ?? null,
        modelFast: c.get<string>('ai.modelFast') ?? null,
        monthlyQuotaPerWorkspace: c.get<number>('ai.monthlyQuotaPerWorkspace') ?? null,
      },
      embedding: { provider, dim: c.get<number>('embedding.dim') ?? null, hasKey: !!embKey },
      redis: { configured: !!c.get<string>('redis.url') || !!c.get<string>('redis.host'), available: this.redis.isAvailable() },
      storage: {
        driver: c.get<string>('storage.driver') ?? 'local',
        maxFileSizeMb: c.get<number>('storage.maxFileSizeMb') ?? null,
        s3Bucket: c.get<string>('storage.s3.bucket') || null,
      },
      integrations: { telegram: !!c.get<boolean>('integrations.telegram.enabled') },
      throttle: { ttl: c.get<number>('throttle.ttl') ?? null, limit: c.get<number>('throttle.limit') ?? null },
      flags: this.settings.flags(),
    };
  }

  async overview() {
    const since30 = new Date(Date.now() - 30 * DAY);
    const since24h = new Date(Date.now() - DAY);
    const since7d = new Date(Date.now() - 7 * DAY);

    const [
      wsActive, wsArchived, usersTotal, usersActive, sysAdmins,
      projects, issuesTotal, issuesDone, attachments, aiAgg, aiSuccess, act24h, act7d,
    ] = await Promise.all([
      this.prisma.workspace.count({ where: { deletedAt: null } }),
      this.prisma.workspace.count({ where: { deletedAt: { not: null } } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { isSystemAdmin: true } }),
      this.prisma.project.count({ where: { deletedAt: null } }),
      this.prisma.issue.count({ where: { deletedAt: null } }),
      this.prisma.issue.count({ where: { deletedAt: null, status: { category: 'DONE' } } }),
      this.prisma.attachment.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      this.prisma.aiGenerationLog.aggregate({
        where: { createdAt: { gte: since30 } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
      }),
      this.prisma.aiGenerationLog.count({ where: { createdAt: { gte: since30 }, success: true } }),
      this.prisma.activityLog.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.activityLog.count({ where: { createdAt: { gte: since7d } } }),
    ]);

    const aiReq = aiAgg._count._all;
    return {
      workspaces: { total: wsActive + wsArchived, active: wsActive, archived: wsArchived },
      users: { total: usersTotal, active: usersActive, deactivated: usersTotal - usersActive, systemAdmins: sysAdmins },
      projects,
      issues: { total: issuesTotal, done: issuesDone, open: issuesTotal - issuesDone },
      attachments: { count: attachments._count._all, totalBytes: Number(attachments._sum.sizeBytes ?? 0) },
      ai: {
        requests: aiReq,
        inputTokens: aiAgg._sum.inputTokens ?? 0,
        outputTokens: aiAgg._sum.outputTokens ?? 0,
        estCostUsd: Number(aiAgg._sum.estimatedCostUsd ?? 0),
        successRate: aiReq > 0 ? Math.round((aiSuccess / aiReq) * 100) : null,
      },
      activity: { last24h: act24h, last7d: act7d },
      degrade: await this.degrade(),
      generatedAt: new Date().toISOString(),
    };
  }
}
