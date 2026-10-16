import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { CronExpressionParser } from 'cron-parser';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  DOMAIN_EVENTS,
  type AutomationEventMeta,
  type AutomationRuleTestResultDto,
  type IssueDto,
  type RuleRunStatus,
  type RuleTrigger,
} from '@tirapro/types';
import {
  parseJql,
  ruleActionSchema,
  ruleConditionSchema,
  triggerConfigSchema,
  type RuleCondition,
  type TriggerConfig,
} from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { withCronLock } from '../../common/cron-lock';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { WRITABLE_PROJECT_FILTER } from '../../common/project-writable';
import { CommentsService } from '../comments/comments.service';
import { IssuesService } from '../issues/issues.service';
import { compileJql } from '../search/jql-compiler';
import { runActions, type ActionContext, type StepLog } from './actions';
import { describeCondition, evalFieldCondition, isJqlCondition } from './rule-conditions';
import { RulesService, type CachedRule } from './rules.service';

export const SYSTEM_USER_EMAIL = 'automation@tirapro.local';
/** Chuỗi automation nối nhau quá số tầng này thì dừng (chống vòng lặp). */
export const MAX_AUTOMATION_DEPTH = 3;
/** Quy tắc theo lịch xử lý tối đa chừng này issue mỗi lần chạy. */
export const SCHEDULED_ISSUE_LIMIT = 500;
const RUN_RETENTION_DAYS = 30;

const conditionsSchema = z.array(ruleConditionSchema);
const actionsSchema = z.array(ruleActionSchema);

/** Phần của payload sự kiện domain mà engine đọc. */
interface EventPayload {
  issue?: IssueDto;
  issueId?: string;
  actorId?: string;
  fromStatusId?: string;
  changedFields?: string[];
  meta?: AutomationEventMeta;
}

interface RunInput {
  rule: CachedRule;
  issue: IssueDto;
  depth: number;
  chain: string[];
  triggerActorId: string | null;
  dryRun: boolean;
  trigger: RuleTrigger;
  /** Quy tắc theo lịch đã lọc JQL ở truy vấn chọn issue nên không cần kiểm lại từng issue. */
  skipJql?: boolean;
}

export interface RunOutcome {
  status: RuleRunStatus;
  log: StepLog[];
}

/**
 * Engine quy tắc khi… nếu… thì…. Lắng nghe sự kiện domain, chọn quy tắc đang bật khớp trigger,
 * kiểm điều kiện rồi chạy action TUẦN TỰ bằng người dùng hệ thống; mỗi lần chạy ghi một `AutomationRun`.
 *
 * Chống vòng lặp (ba lớp): (1) sự kiện do automation gây ra mang `meta.automationDepth` — engine bỏ qua khi
 * `depth >= 3`; (2) `meta.automationChain` liệt kê quy tắc đã chạy trong chuỗi — một quy tắc không chạy lại
 * chính nó qua sự kiện nó gây ra; (3) action không ghi gì nếu giá trị đã đúng (không phát sự kiện thừa).
 */
@Injectable()
export class RuleEngineService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RuleEngineService.name);
  private systemId: string | null = null;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
    private readonly comments: CommentsService,
    private readonly rules: RulesService,
    private readonly events: EventEmitter2,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.systemUserId();
    } catch (err) {
      // DB chưa sẵn sàng lúc khởi động: sẽ tạo lười ở lần chạy quy tắc đầu tiên.
      this.logger.warn(`Chưa tạo được người dùng hệ thống automation: ${(err as Error).message}`);
    }
  }

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  /** Id người dùng hệ thống `automation@tirapro.local` (tạo nếu chưa có; không đăng nhập được vì không có mật khẩu). */
  async systemUserId(): Promise<string> {
    if (this.systemId) return this.systemId;
    const user = await this.prisma.user.upsert({
      where: { email: SYSTEM_USER_EMAIL },
      update: {},
      create: {
        email: SYSTEM_USER_EMAIL,
        displayName: 'Tirapro Automation',
        passwordHash: null,
        status: 'ACTIVE',
        isSystemAdmin: false,
      },
      select: { id: true },
    });
    this.systemId = user.id;
    return user.id;
  }

  /* ----------------------------- sự kiện ----------------------------- */

  @OnEvent(DOMAIN_EVENTS.ISSUE_CREATED)
  onIssueCreated(p: EventPayload): Promise<void> {
    return this.handle('ISSUE_CREATED', p);
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_TRANSITIONED)
  onIssueTransitioned(p: EventPayload): Promise<void> {
    return this.handle('ISSUE_TRANSITIONED', p);
  }

  @OnEvent(DOMAIN_EVENTS.ISSUE_UPDATED)
  onIssueUpdated(p: EventPayload): Promise<void> {
    return this.handle('ISSUE_UPDATED', p);
  }

  @OnEvent(DOMAIN_EVENTS.COMMENT_ADDED)
  onCommentAdded(p: EventPayload): Promise<void> {
    return this.handle('COMMENT_ADDED', p);
  }

  /** Xử lý một sự kiện. Không bao giờ ném: lỗi của automation không được làm hỏng thao tác của người dùng. */
  async handle(trigger: RuleTrigger, p: EventPayload): Promise<void> {
    try {
      const issue = await this.issueOfEvent(p);
      if (!issue) return;
      const depth = p.meta?.automationDepth ?? 0;
      const chain = p.meta?.automationChain ?? [];
      const candidates = await this.rules.activeFor(issue.workspaceId, trigger, issue.projectId);
      for (const rule of candidates) {
        if (this.stopping) return;
        if (!this.triggerMatches(rule, trigger, issue, p)) continue;
        if (depth >= MAX_AUTOMATION_DEPTH) {
          await this.record(
            rule,
            issue.id,
            'SKIPPED',
            [
              {
                step: 'Chống vòng lặp',
                ok: true,
                message: `Chuỗi tự động hoá đã sâu ${depth} tầng (tối đa ${MAX_AUTOMATION_DEPTH}) nên không chạy tiếp`,
              },
            ],
            0,
          );
          continue;
        }
        if (chain.includes(rule.id)) {
          await this.record(
            rule,
            issue.id,
            'SKIPPED',
            [
              {
                step: 'Chống vòng lặp',
                ok: true,
                message: 'Quy tắc này đã chạy trong chính chuỗi sự kiện này — không chạy lại',
              },
            ],
            0,
          );
          continue;
        }
        await this.runRule({
          rule,
          issue,
          depth,
          chain,
          triggerActorId: p.actorId ?? null,
          dryRun: false,
          trigger,
        });
      }
    } catch (err) {
      this.logger.error(
        `Engine automation lỗi khi xử lý ${trigger}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async issueOfEvent(p: EventPayload): Promise<IssueDto | null> {
    if (p.issue) return p.issue;
    if (!p.issueId) return null;
    const row = await this.prisma.issue.findFirst({
      where: { id: p.issueId, deletedAt: null },
      select: { workspaceId: true },
    });
    return row ? this.loadIssue(row.workspaceId, p.issueId) : null;
  }

  private triggerMatches(
    rule: CachedRule,
    trigger: RuleTrigger,
    issue: IssueDto,
    p: EventPayload,
  ): boolean {
    const cfg = this.triggerConfigOf(rule);
    if (trigger === 'ISSUE_TRANSITIONED' && cfg.toStatusId)
      return issue.status.id === cfg.toStatusId;
    if (trigger === 'ISSUE_UPDATED' && cfg.fields?.length) {
      return !!p.changedFields?.some((f) => cfg.fields!.includes(f));
    }
    return true;
  }

  private triggerConfigOf(rule: Pick<CachedRule, 'triggerConfig'>): TriggerConfig {
    const parsed = triggerConfigSchema.safeParse(rule.triggerConfig);
    return parsed.success ? parsed.data : {};
  }

  /* ------------------------------ chạy rule ------------------------------ */

  /** Chạy thử: đánh giá điều kiện + mô tả action, KHÔNG ghi/gửi gì và không ghi AutomationRun. */
  async dryRun(
    workspaceId: string,
    rule: CachedRule,
    issueKey: string,
  ): Promise<AutomationRuleTestResultDto> {
    const issue = await this.issues.getByKey(workspaceId, issueKey, null); // ngữ cảnh hệ thống (người dùng đã qua guard dự án)
    if (rule.projectId && rule.projectId !== issue.projectId) {
      return {
        status: 'SKIPPED',
        log: [
          {
            step: 'Phạm vi',
            ok: true,
            message: 'Công việc không thuộc dự án mà quy tắc này áp dụng',
          },
        ],
      };
    }
    const outcome = await this.runRule({
      rule,
      issue,
      depth: 0,
      chain: [],
      triggerActorId: null,
      dryRun: true,
      trigger: rule.trigger,
    });
    return { status: outcome.status, log: outcome.log };
  }

  async runRule(input: RunInput): Promise<RunOutcome> {
    const { rule, dryRun } = input;
    const started = Date.now();
    let status: RuleRunStatus = 'SUCCESS';
    const log: StepLog[] = [];
    let issueId = input.issue.id;
    try {
      const conditions = conditionsSchema.safeParse(rule.conditions);
      const actions = actionsSchema.safeParse(rule.actions);
      if (!conditions.success || !actions.success) {
        status = 'FAILED';
        log.push({
          step: 'Cấu hình',
          ok: false,
          message:
            'Cấu hình điều kiện/hành động của quy tắc không hợp lệ — hãy mở quy tắc và lưu lại',
        });
      } else {
        const systemId = await this.systemUserId();
        // Luôn dùng issue mới nhất: có thể đã đổi từ lúc sự kiện phát ra (hoặc do quy tắc đứng trước).
        const issue = (await this.loadIssue(input.issue.workspaceId, issueId)) ?? input.issue;
        issueId = issue.id;
        const unmet = await this.firstUnmetCondition(
          conditions.data,
          issue,
          systemId,
          !!input.skipJql,
        );
        if (unmet) {
          status = 'SKIPPED';
          log.push({
            step: 'Điều kiện',
            ok: true,
            message: `Không thoả điều kiện: ${describeCondition(unmet)}`,
          });
        } else {
          const ctx = this.buildContext(input, issue, systemId);
          const result = await runActions(ctx, actions.data);
          log.push(...result.logs);
          status = result.failed ? 'FAILED' : 'SUCCESS';
        }
      }
    } catch (err) {
      status = 'FAILED';
      log.push({
        step: 'Quy tắc',
        ok: false,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      });
    }
    if (!dryRun) await this.record(rule, issueId, status, log, Date.now() - started);
    return { status, log };
  }

  private buildContext(input: RunInput, issue: IssueDto, systemId: string): ActionContext {
    const { rule } = input;
    let actorName: Promise<string> | null = null;
    const ctx: ActionContext = {
      deps: {
        prisma: this.prisma,
        issues: this.issues,
        comments: this.comments,
        events: this.events,
        openSecret: (s: string) => this.rules.openSecret(s),
      },
      workspaceId: issue.workspaceId,
      actorId: systemId,
      rule: { id: rule.id, name: rule.name },
      trigger: input.trigger,
      triggerActorId: input.triggerActorId,
      dryRun: input.dryRun,
      meta: { automationDepth: input.depth + 1, automationChain: [...input.chain, rule.id] },
      issue,
      reload: async () => {
        const fresh = await this.loadIssue(issue.workspaceId, issue.id);
        if (!fresh) throw new NotFoundAppException('Công việc');
        ctx.issue = fresh;
        return fresh;
      },
      actorName: () => {
        actorName ??= input.triggerActorId
          ? this.prisma.user
              .findUnique({ where: { id: input.triggerActorId }, select: { displayName: true } })
              .then((u) => u?.displayName ?? 'Ai đó')
          : Promise.resolve('Tirapro Automation');
        return actorName;
      },
    };
    return ctx;
  }

  /** Điều kiện đầu tiên không thoả (AND), hoặc null nếu thoả hết. */
  private async firstUnmetCondition(
    conditions: RuleCondition[],
    issue: IssueDto,
    systemId: string,
    skipJql: boolean,
  ): Promise<RuleCondition | null> {
    for (const c of conditions) {
      if (isJqlCondition(c)) {
        if (skipJql) continue;
        if (!(await this.matchesJql(c.jql, issue, systemId))) return c;
      } else if (!evalFieldCondition(issue, c)) {
        return c;
      }
    }
    return null;
  }

  /** `jql` → compile → đếm đúng issue này với bộ lọc đó; 1 = khớp. */
  private async matchesJql(jql: string, issue: IssueDto, systemId: string): Promise<boolean> {
    const { where } = compileJql(parseJql(jql), { currentUserId: systemId });
    const n = await this.prisma.issue.count({
      where: { id: issue.id, workspaceId: issue.workspaceId, deletedAt: null, AND: [where] },
    });
    return n === 1;
  }

  private async loadIssue(workspaceId: string, issueId: string): Promise<IssueDto | null> {
    const page = await this.issues.query(workspaceId, { id: issueId }, [], undefined, 1, null);
    return page.data[0] ?? null;
  }

  /** Ghi AutomationRun + cập nhật thống kê quy tắc (SKIPPED không tính là một lần chạy). Lỗi ghi log chỉ cảnh báo. */
  private async record(
    rule: CachedRule,
    issueId: string | null,
    status: RuleRunStatus,
    log: StepLog[],
    durationMs: number,
  ): Promise<void> {
    try {
      await this.prisma.automationRun.create({
        data: {
          ruleId: rule.id,
          issueId,
          status,
          log: log as unknown as Prisma.InputJsonValue,
          durationMs,
        },
      });
      if (status !== 'SKIPPED') {
        await this.prisma.automationRule.update({
          where: { id: rule.id },
          data: { lastRunAt: new Date(), runCount: { increment: 1 } },
        });
      }
    } catch (err) {
      this.logger.warn(`Không ghi được lần chạy của quy tắc ${rule.id}: ${(err as Error).message}`);
    }
  }

  /* ------------------------------ theo lịch ------------------------------ */

  /** Mỗi phút: quy tắc SCHEDULED có cron khớp phút hiện tại chạy trên tập issue chọn bởi điều kiện JQL. */
  @Cron('* * * * *')
  async onMinute(): Promise<void> {
    try {
      await withCronLock(this.redis, 'automation-scheduled-rules', 55, () =>
        this.runScheduled(new Date()),
      );
    } catch (err) {
      this.logger.error(`Cron quy tắc theo lịch lỗi: ${(err as Error).message}`);
    }
  }

  async runScheduled(now: Date): Promise<void> {
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const rules = await this.prisma.automationRule.findMany({
      where: { enabled: true, trigger: 'SCHEDULED', workspace: { deletedAt: null } },
    });
    for (const row of rules) {
      if (this.stopping) return;
      const cfg = this.triggerConfigOf(row);
      if (!cfg.cron || !this.cronMatches(cfg.cron, minute)) continue;
      // "Nhận" lượt chạy phút này một cách nguyên tử — hai node (hoặc hai lần quét) không chạy trùng.
      const claimed = await this.prisma.automationRule.updateMany({
        where: { id: row.id, OR: [{ lastRunAt: null }, { lastRunAt: { lt: minute } }] },
        data: { lastRunAt: new Date() },
      });
      if (claimed.count === 0) continue;
      try {
        await this.runScheduledRule({ ...row, lastRunAt: row.lastRunAt?.toISOString() ?? null });
      } catch (err) {
        this.logger.error(`Quy tắc theo lịch ${row.id} lỗi: ${(err as Error).message}`);
      }
    }
  }

  cronMatches(expression: string, minute: Date): boolean {
    try {
      const it = CronExpressionParser.parse(expression, {
        currentDate: new Date(minute.getTime() + 30_000),
        tz: 'UTC',
      });
      return it.prev().toDate().getTime() === minute.getTime();
    } catch {
      return false;
    }
  }

  private async runScheduledRule(rule: CachedRule): Promise<void> {
    const parsed = conditionsSchema.safeParse(rule.conditions);
    if (!parsed.success) return;
    const systemId = await this.systemUserId();
    const wheres: Prisma.IssueWhereInput[] = [];
    for (const c of parsed.data) {
      if (isJqlCondition(c))
        wheres.push(compileJql(parseJql(c.jql), { currentUserId: systemId }).where);
    }
    const where: Prisma.IssueWhereInput = {
      AND: [
        ...wheres,
        // Cron không có người dùng để báo lỗi: dự án lưu trữ/xoá bị bỏ qua im lặng (như recurring), không sinh run FAILED mỗi phút.
        { project: WRITABLE_PROJECT_FILTER },
        ...(rule.projectId ? [{ projectId: rule.projectId }] : []),
      ],
    };
    const page = await this.issues.query(
      rule.workspaceId,
      where,
      [],
      undefined,
      SCHEDULED_ISSUE_LIMIT,
      null,
    );
    for (const issue of page.data) {
      if (this.stopping) return;
      await this.runRule({
        rule,
        issue,
        depth: 0,
        chain: [],
        triggerActorId: null,
        dryRun: false,
        trigger: 'SCHEDULED',
        skipJql: true,
      });
    }
  }

  /** Dọn lịch sử chạy cũ (giữ 30 ngày) để bảng AutomationRun không phình vô hạn. */
  @Cron('15 3 * * *')
  async pruneRuns(): Promise<void> {
    try {
      await withCronLock(this.redis, 'automation-prune-runs', 300, async () => {
        const before = new Date(Date.now() - RUN_RETENTION_DAYS * 86_400_000);
        const { count } = await this.prisma.automationRun.deleteMany({
          where: { createdAt: { lt: before } },
        });
        if (count)
          this.logger.log(`Đã dọn ${count} lần chạy quy tắc cũ hơn ${RUN_RETENTION_DAYS} ngày`);
      });
    } catch (err) {
      this.logger.error(`Dọn lịch sử chạy lỗi: ${(err as Error).message}`);
    }
  }
}
