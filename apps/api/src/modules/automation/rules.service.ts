import { Injectable, Logger } from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import type { AutomationRule, Prisma } from '@prisma/client';
import {
  type AutomationRuleDto,
  type AutomationRunDto,
  type AutomationRunStepDto,
  type RuleTrigger,
} from '@tirapro/types';
import {
  parseJql,
  JqlParseError,
  type CreateRuleInput,
  type RuleCondition,
  type UpdateRuleInput,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertProjectIdWritable } from '../../common/project-writable';
import { TelegramService } from '../integrations/telegram.service';
import { maskWebhookActions, openSecret, sealWebhookActions } from './webhook-secret';

const CACHE_TTL_SEC = 60;
const cacheKey = (workspaceId: string) => `automation:rules:${workspaceId}`;
const RUNS_PAGE = 50;

type RuleRow = AutomationRule;

/** Hình dạng quy tắc dùng ở engine — chỉ các cột cần, Date đã serialize được qua Redis. */
export type CachedRule = Omit<RuleRow, 'lastRunAt' | 'createdAt' | 'updatedAt'> & {
  lastRunAt: string | null;
};

/**
 * CRUD quy tắc automation + cache danh sách quy tắc đang bật theo workspace
 * (Redis 60 giây khi có, nếu không thì Map trong bộ nhớ). Cache bị xoá khi quy tắc đổi.
 */
@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);
  private readonly memory = new Map<string, { at: number; rules: CachedRule[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cipher: TelegramService,
  ) {}

  /* ------------------------------ cache ------------------------------ */

  /** Quy tắc ĐANG BẬT của workspace áp cho `trigger` + dự án của issue (rule.projectId null = cả workspace). */
  async activeFor(
    workspaceId: string,
    trigger: RuleTrigger,
    projectId: string,
  ): Promise<CachedRule[]> {
    const all = await this.enabledRules(workspaceId);
    return all.filter(
      (r) => r.trigger === trigger && (r.projectId === null || r.projectId === projectId),
    );
  }

  private async enabledRules(workspaceId: string): Promise<CachedRule[]> {
    const key = cacheKey(workspaceId);
    const client = this.redis.isAvailable() ? this.redis.getClient() : null;
    if (client) {
      try {
        const hit = await client.get(key);
        if (hit) return JSON.parse(hit) as CachedRule[];
      } catch {
        /* Redis lỗi: đọc thẳng DB */
      }
    } else {
      const m = this.memory.get(workspaceId);
      if (m && Date.now() - m.at < CACHE_TTL_SEC * 1000) return m.rules;
    }
    const rows = await this.prisma.automationRule.findMany({
      where: { workspaceId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    const rules: CachedRule[] = rows.map((r) => ({
      ...r,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
    }));
    if (client) client.set(key, JSON.stringify(rules), 'EX', CACHE_TTL_SEC).catch(() => undefined);
    else this.memory.set(workspaceId, { at: Date.now(), rules });
    return rules;
  }

  async invalidate(workspaceId: string): Promise<void> {
    this.memory.delete(workspaceId);
    const client = this.redis.isAvailable() ? this.redis.getClient() : null;
    if (client) await client.del(cacheKey(workspaceId)).catch(() => undefined);
  }

  /* ------------------------------- CRUD ------------------------------ */

  async list(workspaceId: string, projectId?: string): Promise<AutomationRuleDto[]> {
    const rows = await this.prisma.automationRule.findMany({
      where: {
        workspaceId,
        // Có projectId: quy tắc của dự án đó + quy tắc cả workspace; không có: tất cả.
        ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(workspaceId: string, id: string): Promise<AutomationRuleDto> {
    return this.toDto(await this.require(workspaceId, id));
  }

  async create(
    workspaceId: string,
    userId: string,
    input: CreateRuleInput,
  ): Promise<AutomationRuleDto> {
    if (input.projectId) await this.assertProject(workspaceId, input.projectId);
    await assertProjectIdWritable(this.prisma, input.projectId);
    this.assertSemantics(input.trigger, input.triggerConfig, input.conditions);
    const row = await this.prisma.automationRule.create({
      data: {
        workspaceId,
        projectId: input.projectId ?? null,
        name: input.name,
        enabled: input.enabled ?? true,
        trigger: input.trigger,
        triggerConfig: input.triggerConfig,
        conditions: input.conditions as Prisma.InputJsonValue,
        actions: sealWebhookActions(this.cipher, input.actions, undefined) as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    await this.invalidate(workspaceId);
    return this.toDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    input: UpdateRuleInput,
  ): Promise<AutomationRuleDto> {
    const current = await this.require(workspaceId, id);
    await assertProjectIdWritable(this.prisma, current.projectId);
    const trigger = input.trigger ?? current.trigger;
    const triggerConfig = input.triggerConfig ?? (current.triggerConfig as Record<string, unknown>);
    const conditions = input.conditions ?? (current.conditions as unknown as RuleCondition[]);
    this.assertSemantics(trigger, triggerConfig, conditions);
    const { count } = await this.prisma.automationRule.updateMany({
      where: { id, workspaceId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.triggerConfig !== undefined ? { triggerConfig: input.triggerConfig } : {}),
        ...(input.conditions !== undefined
          ? { conditions: input.conditions as Prisma.InputJsonValue }
          : {}),
        ...(input.actions !== undefined
          ? {
              actions: sealWebhookActions(
                this.cipher,
                input.actions,
                current.actions as unknown[],
              ) as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    if (count === 0) throw new NotFoundAppException('Quy tắc');
    await this.invalidate(workspaceId);
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string): Promise<{ success: true }> {
    const row = await this.require(workspaceId, id);
    await assertProjectIdWritable(this.prisma, row.projectId);
    const { count } = await this.prisma.automationRule.deleteMany({ where: { id, workspaceId } });
    if (count === 0) throw new NotFoundAppException('Quy tắc');
    await this.invalidate(workspaceId);
    return { success: true };
  }

  async runs(workspaceId: string, id: string, cursor?: string): Promise<AutomationRunDto[]> {
    await this.require(workspaceId, id);
    const rows = await this.prisma.automationRun.findMany({
      where: { ruleId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RUNS_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const issueIds = [...new Set(rows.map((r) => r.issueId).filter((x): x is string => !!x))];
    const keys = issueIds.length
      ? // allow-deleted: chỉ tra mã để hiển thị lịch sử chạy — issue đã xoá vẫn phải hiện đúng mã
        await this.prisma.issue.findMany({
          where: { id: { in: issueIds }, workspaceId },
          select: { id: true, key: true },
        })
      : [];
    const keyById = new Map(keys.map((k) => [k.id, k.key]));
    return rows.map((r) => ({
      id: r.id,
      ruleId: r.ruleId,
      issueId: r.issueId,
      issueKey: r.issueId ? (keyById.get(r.issueId) ?? null) : null,
      status: r.status,
      log: r.log as unknown as AutomationRunStepDto[],
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Giải mã khoá bí mật webhook đã lưu (cache/DB giữ bản mã hoá); null = không giải mã được. */
  openSecret(stored: string): string | null {
    return openSecret(this.cipher, stored);
  }

  /** Dùng bởi controller/engine: quy tắc thuộc workspace hoặc NotFound. */
  async require(workspaceId: string, id: string): Promise<RuleRow> {
    const row = await this.prisma.automationRule.findFirst({ where: { id, workspaceId } });
    if (!row) throw new NotFoundAppException('Quy tắc');
    return row;
  }

  /* ----------------------------- validation --------------------------- */

  private async assertProject(workspaceId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
  }

  /** Các ràng buộc zod không kiểm được: cron hợp lệ, SCHEDULED có JQL, JQL parse được. */
  private assertSemantics(
    trigger: RuleTrigger,
    triggerConfig: { cron?: string },
    conditions: RuleCondition[],
  ): void {
    for (const c of conditions) {
      if (!('jql' in c)) continue;
      try {
        parseJql(c.jql);
      } catch (e) {
        if (e instanceof JqlParseError)
          throw new BusinessRuleException(`JQL trong điều kiện chưa đúng: ${e.message}`);
        throw e;
      }
    }
    if (trigger !== 'SCHEDULED') return;
    if (!triggerConfig.cron)
      throw new BusinessRuleException(
        'Quy tắc theo lịch cần biểu thức cron, ví dụ "0 9 * * 1-5" (9 giờ sáng các ngày trong tuần)',
      );
    try {
      CronExpressionParser.parse(triggerConfig.cron, { tz: 'UTC' });
    } catch {
      throw new BusinessRuleException(
        'Biểu thức cron chưa đúng — cần 5 trường: phút giờ ngày tháng thứ (giờ UTC)',
      );
    }
    if (!conditions.some((c) => 'jql' in c)) {
      throw new BusinessRuleException(
        'Quy tắc theo lịch cần một điều kiện JQL để chọn các công việc cần xử lý',
      );
    }
  }

  private toDto(r: RuleRow): AutomationRuleDto {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      projectId: r.projectId,
      name: r.name,
      enabled: r.enabled,
      trigger: r.trigger,
      triggerConfig: r.triggerConfig as Record<string, unknown>,
      conditions: r.conditions as unknown as Array<Record<string, unknown>>,
      actions: maskWebhookActions(r.actions as unknown[]) as Array<Record<string, unknown>>,
      createdById: r.createdById,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      runCount: r.runCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
