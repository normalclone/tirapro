import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Danh sách model có soft-delete (deletedAt) — phải khớp schema.prisma (soft-delete-coverage.spec.ts kiểm).
 * Service tự lọc `deletedAt: null`; spec đó chặn truy vấn đọc thiếu lọc. TODO: chuyển sang Prisma
 * `$extends` (query.$allModels) khi có DB test để kiểm chứng.
 */
export const SOFT_DELETE_MODELS = new Set([
  'Workspace',
  'Project',
  'Issue',
  'Comment',
  'Sprint',
  'Board',
  'CustomField',
  'Dashboard',
  'SavedFilter',
  'Team',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }]
          : [{ level: 'error', emit: 'stdout' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
