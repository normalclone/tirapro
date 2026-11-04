import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { MailService } from '../mail/mail.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacModule } from '../rbac/rbac.module';
import { WorkflowAdminModule } from './workflow-admin.module';
import { WorkflowResolver } from './workflow-resolver.service';
import { WorkflowSchemeService } from './workflow-scheme.service';

/** Hạ tầng dùng chung (toàn cục trong app thật) — thay bằng bản giả để dựng module thật mà không cần DB/Redis. */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: RedisService, useValue: {} },
    { provide: EventEmitter2, useValue: { emit: vi.fn() } },
    { provide: MailService, useValue: {} },
    { provide: ConfigService, useValue: { get: vi.fn() } },
  ],
  exports: [PrismaService, RedisService, EventEmitter2, MailService, ConfigService],
})
class InfraStub {}

describe('WorkflowAdminModule — Nest DI', () => {
  it('dựng được module thật; WorkflowSchemeService nhận ProjectAccessService THẬT (không còn tuỳ chọn)', async () => {
    const mod = await Test.createTestingModule({
      imports: [InfraStub, RbacModule, WorkflowAdminModule],
    }).compile();
    const svc = mod.get(WorkflowSchemeService);
    expect(svc).toBeInstanceOf(WorkflowSchemeService);
    expect((svc as unknown as { access: unknown }).access).toBeInstanceOf(ProjectAccessService);
    expect((svc as unknown as { access: unknown }).access).toBe(mod.get(ProjectAccessService));
  });

  it('thiếu ProjectAccessService thì Nest từ chối dựng (không âm thầm bỏ lọc dự án riêng tư)', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          WorkflowSchemeService,
          { provide: PrismaService, useValue: {} },
          WorkflowResolver,
        ],
      }).compile(),
    ).rejects.toThrow(/ProjectAccessService/);
  });
});
