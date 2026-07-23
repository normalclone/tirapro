import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Danh sách model có soft-delete (deletedAt). Service tự lọc deletedAt khi cần. */
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

  /** Helper: chỉ trả record chưa xóa mềm. Dùng spread vào where. */
  notDeleted<T extends object>(where?: T): T & { deletedAt: null } {
    return { ...(where ?? ({} as T)), deletedAt: null };
  }
}
