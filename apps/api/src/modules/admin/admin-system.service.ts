import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { offsetPage } from '../../common/dto/page-result';
import type { AuditQueryInput } from './admin-console.schemas';

/** Tình trạng dịch vụ + nhật ký kiểm toán toàn hệ thống — chỉ admin hệ thống. */
@Injectable()
export class AdminSystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly settings: SystemSettingsService,
  ) {}

  async health() {
    let db = false;
    let dbLatencyMs: number | null = null;
    try {
      const t0 = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t0;
      db = true;
    } catch {
      db = false;
    }
    const mem = process.memoryUsage();
    return {
      db,
      dbLatencyMs,
      redis: this.redis.isAvailable(),
      redisConfigured: !!this.config.get<string>('redis.url') || !!this.config.get<string>('redis.host'),
      ai: !!this.config.get<boolean>('ai.enabled') && !!this.config.get<string>('ai.anthropicApiKey') && !this.settings.flags().aiKillSwitch,
      uptimeSec: Math.round(process.uptime()),
      memoryRssMb: Math.round(mem.rss / 1_048_576),
      heapUsedMb: Math.round(mem.heapUsed / 1_048_576),
      nodeEnv: this.config.get<string>('nodeEnv') ?? 'development',
      release: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  async audit(params: AuditQueryInput) {
    const rows = await this.prisma.activityLog.findMany({
      where: {
        ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
        ...(params.action ? { action: params.action as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      select: {
        id: true, action: true, entityType: true, entityId: true, field: true, actorId: true, createdAt: true,
        workspace: { select: { id: true, name: true } },
      },
    });

    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, avatarUrl: true },
        })
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    const data = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      field: r.field,
      createdAt: r.createdAt.toISOString(),
      workspace: r.workspace,
      actor: r.actorId ? actorMap.get(r.actorId) ?? null : null,
    }));
    return offsetPage(data, 1, Math.max(1, data.length), data.length);
  }
}
