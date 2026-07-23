import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SystemSettingsService,
  ) {}

  @Public()
  @Get()
  async check() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const redis = this.redis.isAvailable();
    return {
      status: db ? 'ok' : 'degraded',
      db,
      redis,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
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
