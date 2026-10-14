import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../../common/types/request';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';

/** Giới hạn chờ DB/Redis cho readiness. */
const READY_TIMEOUT_MS = 2000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SystemSettingsService,
  ) {}

  /** Liveness: tiến trình còn sống — KHÔNG chạm DB/Redis (LB/k8s dùng để quyết định restart). */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: sẵn sàng nhận traffic? DB phải trả lời `SELECT 1` trong 2 giây, Redis (nếu có) phải ping được.
   * DB lỗi → 503 để LB rút node khỏi vòng. Redis là tuỳ chọn (app chạy giảm cấp) nên chỉ báo trạng thái.
   */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.all([this.pingDb(), this.pingRedis()]);
    if (!db) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: db ? 'ok' : 'unavailable', db, redis };
  }

  /**
   * Tổng quan sức khoẻ. Công khai (LB cũ vẫn gọi) nhưng chỉ trả chi tiết (db/redis/uptime)
   * cho quản trị hệ thống; khách chỉ thấy `status`.
   */
  @Public()
  @OptionalAuth()
  @Get()
  async check(@CurrentUser() user?: AuthUser) {
    const db = await this.pingDb();
    const status = db ? 'ok' : 'degraded';
    if (!user?.isSystemAdmin) return { status };
    return {
      status,
      db,
      redis: this.redis.isAvailable(),
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async pingDb(): Promise<boolean> {
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), READY_TIMEOUT_MS).unref()),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /** `true` ping được, `false` có cấu hình nhưng không ping được, `null` không dùng Redis. */
  private async pingRedis(): Promise<boolean | null> {
    const client = this.redis.getClient();
    if (!client) return null;
    if (!this.redis.isAvailable()) return false;
    try {
      await Promise.race([
        client.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), READY_TIMEOUT_MS).unref()),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /** Thông báo hệ thống công khai (banner bảo trì, trạng thái đăng ký) — mọi client đọc được. */
  @Public()
  @Get('announcement')
  announcement() {
    const flags = this.settings.flags();
    return {
      maintenanceBanner: flags.maintenanceBanner,
      signupEnabled: flags.signupEnabled,
    };
  }

  /** Phiên bản API — hợp đồng ổn định cho client (prefix /api/v1). */
  @Public()
  @Get('version')
  version() {
    return {
      name: 'tirapro-api',
      apiVersion: 'v1',
      release: process.env.npm_package_version ?? '0.1.0',
    };
  }
}
