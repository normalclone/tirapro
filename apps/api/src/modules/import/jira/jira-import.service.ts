import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createId } from '@paralleldrive/cuid2';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Prisma } from '@prisma/client';
import {
  JIRA_CREATE,
  jiraAnalyzeIdSchema,
  normalizeJiraKey,
  type JiraImportOptions,
  type JiraImportRunInput,
} from '@tirapro/shared';
import type { CreateIssueInput } from '@tirapro/shared';
import type { JiraAnalyzeResult, JiraDryRunResult, JiraImportTargets } from '@tirapro/types';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../../common/exceptions/app.exception';
import { ProjectsService } from '../../projects/projects.service';
import { ImportService, type PreparedItem } from '../import.service';
import {
  analyzeJira,
  commentAuthorName,
  parseJiraCsvAsync,
  type JiraIssueRow,
  type JiraParseResult,
} from './jira-csv.parser';
import {
  findMissingMapping,
  formatMissing,
  formatRemembered,
  formatUnmatchedAssignees,
  hasMissing,
  inferPriorityRank,
  inferStatusCategory,
  isEpicTypeName,
  isSubtaskTypeName,
  layerIssues,
  ownValue,
  newAssigneeTally,
  pendingEmailFor,
  resolveLinks,
  summarizeRemembered,
  summarizeUnmatchedAssignees,
  tallyAssignee,
  type IssueLinks,
} from './jira-mapping';

/** Tệp phân tích sống tối đa 1 giờ. */
const ANALYZE_TTL_MS = 60 * 60 * 1000;
/** Giới hạn tệp tải lên (MB) — dùng chung với controller. */
export const JIRA_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Số dòng tối đa ghi vào errorLog (tránh cột Text phình khi hàng nghìn dòng lỗi). */
const MAX_ERROR_LOG_LINES = 5000;
const SUMMARY_MAX = 255;
/** Job RUNNING mà `updatedAt` (heartbeat) cũ hơn mức này bị coi là kẹt. */
const STALE_JOB_MS = 3 * 60 * 1000;
/** Chu kỳ phát heartbeat khi job đang chạy (phải nhỏ hơn nhiều so với STALE_JOB_MS). */
const HEARTBEAT_MS = 30 * 1000;
/** Giá trị `config.format` của ImportJob do service này tạo (create + configWith). */
const JIRA_JOB_FORMAT = 'jira-csv';

type Category = 'TODO' | 'IN_PROGRESS' | 'DONE';

interface Catalog {
  types: Array<{ id: string; name: string; key: string | null; isSubtask: boolean }>;
  priorities: Array<{ id: string; name: string }>;
  resolutions: Array<{ id: string; name: string }>;
  memberIds: Set<string>;
}

/** Tất cả những gì `execute` cần — dựng sau khi mọi kiểm tra đồng bộ đã qua. */
interface RunContext {
  workspaceId: string;
  userId: string;
  jobId: string;
  analyzeId: string;
  parsed: JiraParseResult;
  input: JiraImportRunInput;
  catalog: Catalog;
  /** Project có sẵn (đã kiểm tra thuộc workspace); undefined khi tạo project mới. */
  existingProject?: { id: string; key: string; defaultWorkflowId: string | null };
}

interface Plan {
  links: Map<JiraIssueRow, IssueLinks>;
  layers: JiraIssueRow[][];
  isEpic: (r: JiraIssueRow) => boolean;
  isSubtask: (r: JiraIssueRow) => boolean;
  epics: number;
  subtasks: number;
  sprintNames: string[];
  labels: number;
  comments: number;
}

/** Việc đã có mã này trong workspace (kể cả đã xoá mềm — unique `(workspaceId, key)` vẫn giữ mã). */
interface ExistingKey {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  deleted: boolean;
}

/** Kế hoạch mã Jira cho một lượt nhập (L27): dòng nào dùng mã gốc, dòng nào bỏ qua vì trùng, dòng nào sai dạng. */
interface KeyPlan {
  /** Dòng → mã Jira đã chuẩn hoá, dùng làm `Issue.key`. */
  fixed: Map<JiraIssueRow, string>;
  /** Dòng bị bỏ qua vì mã trùng (đã có trong workspace, hoặc lặp trong tệp — `existing` rỗng). */
  skip: Map<JiraIssueRow, { message: string; existing?: ExistingKey }>;
  /** Dòng có mã sai dạng → vẫn tạo bằng mã Tirapro tự sinh. */
  invalid: Map<JiraIssueRow, string>;
}

const NO_KEY_PLAN = (): KeyPlan => ({ fixed: new Map(), skip: new Map(), invalid: new Map() });
/** Số mã tra mỗi truy vấn (tránh vượt giới hạn tham số bind của Postgres). */
const KEY_LOOKUP_CHUNK = 5000;
/** Dry-run chỉ liệt kê tối đa chừng này dòng cảnh báo mã (còn lại gộp một dòng). */
const DRY_RUN_KEY_WARNINGS = 20;

interface AnalyzeMeta {
  workspaceId: string;
  userId: string;
}

const INTERRUPTED_MESSAGE =
  'Tiến trình import bị gián đoạn (máy chủ khởi động lại hoặc dừng đột ngột). Các việc đã tạo trước đó được giữ nguyên — hãy kiểm tra dự án rồi import lại phần còn thiếu.';
const ALREADY_RUN_MESSAGE =
  'Phiên phân tích này đã (hoặc đang) được import — hãy tải lại tệp CSV để tạo phiên mới nếu muốn import lại';
const EXPIRED_MESSAGE =
  'Phiên phân tích đã hết hạn (giữ tối đa 1 giờ) hoặc không tồn tại — hãy tải lại tệp CSV để phân tích lại';

@Injectable()
export class JiraImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JiraImportService.name);
  private readonly localDir: string;
  /** Các job đang chạy trong process (để test/tắt máy chờ được). */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly importService: ImportService,
    private readonly projects: ProjectsService,
    config: ConfigService,
  ) {
    this.localDir = config.get<string>('storage.localDir') ?? './uploads';
  }

  // ---------------------------------------------------------------- khôi phục job kẹt

  /** Khi khởi động: job RUNNING bị bỏ lại bởi lần chạy trước (crash/restart) → FAILED. */
  async onApplicationBootstrap(): Promise<void> {
    await this.recoverStaleJobs().catch((e: unknown) =>
      this.logger.warn(`Khôi phục job import kẹt thất bại: ${this.errMessage(e)}`),
    );
  }

  /** Quét định kỳ cho trường hợp process chết mà không restart ngay (hoặc node khác chết). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepStaleJobs(): Promise<void> {
    await this.recoverStaleJobs().catch((e: unknown) =>
      this.logger.warn(`Quét job import kẹt thất bại: ${this.errMessage(e)}`),
    );
  }

  /**
   * Đánh FAILED mọi ImportJob Jira `RUNNING` mà heartbeat (`updatedAt`) cũ hơn `staleMs`. Job đang chạy
   * thật ở bất kỳ node nào đều phát heartbeat (mỗi lô + mỗi ~30s) nên không bị đụng tới; job của
   * chính process này (`this.running`) luôn được loại trừ. Không requeue: issue đã tạo dở nên chạy
   * lại sẽ trùng. Một `updateMany` idempotent ⇒ nhiều node cùng quét cũng an toàn.
   */
  async recoverStaleJobs(staleMs = STALE_JOB_MS): Promise<number> {
    const { count } = await this.prisma.importJob.updateMany({
      where: {
        status: 'RUNNING',
        // Chỉ job Jira (có heartbeat). Job CSV/JSON của ImportService chạy đồng bộ trong request,
        // không heartbeat và không nằm trong `running` ⇒ quét nhầm sẽ đánh FAILED job đang chạy thật.
        config: { path: ['format'], equals: JIRA_JOB_FORMAT },
        updatedAt: { lt: new Date(Date.now() - staleMs) },
        id: { notIn: [...this.running.keys()] },
      },
      data: { status: 'FAILED', completedAt: new Date(), errorLog: INTERRUPTED_MESSAGE },
    });
    if (count) this.logger.warn(`Đã đánh FAILED ${count} job import bị gián đoạn`);
    return count;
  }

  /** Phát heartbeat: chạm `updatedAt` (chỉ khi job còn RUNNING). Lỗi DB chỉ cảnh báo. */
  private async touchJob(jobId: string): Promise<void> {
    try {
      await this.prisma.importJob.updateMany({
        where: { id: jobId, status: 'RUNNING' },
        data: { updatedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`Không ghi được heartbeat của job ${jobId}: ${this.errMessage(e)}`);
    }
  }

  // ---------------------------------------------------------------- bước 1: analyze

  /** Lưu tệp, parse và trả tóm tắt để dựng bảng mapping. */
  async analyze(
    workspaceId: string,
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<JiraAnalyzeResult> {
    if (!file?.buffer?.length)
      throw new BusinessRuleException('Thiếu tệp CSV — hãy chọn tệp export từ Jira rồi thử lại');
    if (file.size > JIRA_MAX_UPLOAD_BYTES)
      throw new BusinessRuleException(
        'Tệp vượt quá 25MB — hãy xuất Jira theo từng project hoặc khoảng thời gian nhỏ hơn',
      );
    const looksCsv =
      /\.csv$/i.test(file.originalname ?? '') || /csv|excel|text\/plain/i.test(file.mimetype ?? '');
    if (!looksCsv)
      throw new BusinessRuleException(
        'Chỉ nhận tệp .csv — hãy xuất Jira bằng "Export issues → CSV"',
      );

    let parsed: JiraParseResult;
    try {
      parsed = await parseJiraCsvAsync(file.buffer);
    } catch (err) {
      throw new BusinessRuleException(this.errMessage(err));
    }
    if (parsed.issues.length === 0)
      throw new BusinessRuleException(
        'Tệp không có issue nào — hãy kiểm tra lại bộ lọc khi xuất từ Jira',
      );

    await this.purgeExpired();
    const analyzeId = createId();
    const dir = this.dir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${analyzeId}.csv`), file.buffer);
    const meta: AnalyzeMeta = { workspaceId, userId };
    await fs.writeFile(path.join(dir, `${analyzeId}.json`), JSON.stringify(meta));

    return { analyzeId, ...analyzeJira(parsed) };
  }

  /** Giá trị Tirapro để chọn trong bảng mapping (bước 2). */
  async targets(workspaceId: string, projectId?: string): Promise<JiraImportTargets> {
    const [projects, issueTypes, priorities, members] = await Promise.all([
      this.prisma.project.findMany({
        where: { workspaceId, deletedAt: null, isArchived: false },
        orderBy: { name: 'asc' },
        select: { id: true, key: true, name: true },
      }),
      this.prisma.issueType.findMany({
        where: { workspaceId },
        orderBy: { hierarchyLevel: 'asc' },
        select: { id: true, name: true, isSubtask: true },
      }),
      this.prisma.priority.findMany({
        where: { workspaceId },
        orderBy: { rank: 'desc' },
        select: { id: true, name: true },
      }),
      this.prisma.workspaceMembership.findMany({
        where: { workspaceId },
        select: { user: { select: { id: true, displayName: true, email: true } } },
      }),
    ]);
    let statuses: JiraImportTargets['statuses'] = [];
    if (projectId) {
      const project = projects.find((p) => p.id === projectId);
      if (!project) throw new NotFoundAppException('Dự án');
      const full = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { defaultWorkflowId: true },
      });
      if (full?.defaultWorkflowId) {
        statuses = await this.prisma.status.findMany({
          where: { workflowId: full.defaultWorkflowId },
          orderBy: { order: 'asc' },
          select: { id: true, name: true },
        });
      }
    }
    return {
      projects,
      issueTypes,
      priorities,
      statuses,
      members: members
        .map((m) => m.user)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  }

  // ---------------------------------------------------------------- bước 3: run

  /**
   * Kiểm tra mapping rồi (nếu không dry-run) tạo ImportJob và chạy nền trong process.
   * Trả `{ jobId }` ngay; web poll `GET /import/jobs/:id`.
   */
  async run(
    workspaceId: string,
    userId: string,
    input: JiraImportRunInput,
  ): Promise<{ jobId: string } | JiraDryRunResult> {
    const parsed = await this.load(workspaceId, input.analyzeId);
    const analysis = analyzeJira(parsed);

    const missing = findMissingMapping(analysis, input.mapping);
    if (hasMissing(missing)) throw new BusinessRuleException(formatMissing(missing));

    let existingProject: RunContext['existingProject'];
    if (input.projectId) {
      const p = await this.prisma.project.findFirst({
        where: { id: input.projectId, workspaceId, deletedAt: null },
        select: { id: true, key: true, defaultWorkflowId: true },
      });
      if (!p) throw new NotFoundAppException('Dự án');
      existingProject = p;
    } else if (input.newProject) {
      const dup = await this.prisma.project.findFirst({
        where: { workspaceId, key: input.newProject.key, deletedAt: null },
        select: { id: true },
      });
      if (dup)
        throw new BusinessRuleException(
          `Mã dự án "${input.newProject.key}" đã tồn tại trong không gian làm việc này — hãy chọn mã khác`,
        );
    }

    const catalog = await this.loadCatalog(workspaceId);
    const statuses = existingProject?.defaultWorkflowId
      ? await this.prisma.status.findMany({
          where: { workflowId: existingProject.defaultWorkflowId },
          select: { id: true, name: true, category: true },
        })
      : [];
    this.assertTargets(input, catalog, statuses, Boolean(existingProject));

    const plan = this.plan(parsed, input, catalog);

    if (input.options.dryRun) {
      const keyPlan = input.options.keepJiraKey
        ? // Phản hồi dry-run chỉ đến tay quản trị (jira/run = workspace:admin, thấy mọi dự án) nên nêu mã dự án đang giữ mã.
          await this.planKeys(workspaceId, parsed.issues, { revealProjects: true })
        : NO_KEY_PLAN();
      const keyWarnings = this.keyWarnings(keyPlan);
      const assigneeNotes = this.dryRunAssignees(parsed.issues, input.mapping);
      return {
        dryRun: true,
        total: parsed.issues.length,
        epics: plan.epics,
        subtasks: plan.subtasks,
        sprints: input.options.importSprints ? plan.sprintNames.length : 0,
        labels: plan.labels,
        comments: input.options.importComments ? plan.comments : 0,
        duplicateKeys: keyPlan.skip.size,
        invalidKeys: keyPlan.invalid.size,
        rememberedAssignees: assigneeNotes.remembered,
        warnings: [
          ...keyWarnings.slice(0, DRY_RUN_KEY_WARNINGS),
          ...(keyWarnings.length > DRY_RUN_KEY_WARNINGS
            ? [`… và ${keyWarnings.length - DRY_RUN_KEY_WARNINGS} cảnh báo về mã nữa`]
            : []),
          ...[...plan.links.entries()].flatMap(([r, l]) =>
            l.warnings.map((w) => this.line(r, w, true)),
          ),
          ...assigneeNotes.lines,
        ],
      };
    }

    // Claim nguyên tử `<id>.json` → `<id>.claimed`: chỉ MỘT request qua được; request song song
    // hoặc bấm "Chạy" lần hai nhận lỗi thay vì tạo job + issue trùng.
    await this.claim(input.analyzeId);
    let job: { id: string };
    try {
      job = await this.prisma.importJob.create({
        data: {
          workspaceId,
          source: 'JIRA_CLOUD',
          status: 'RUNNING',
          createdById: userId,
          startedAt: new Date(),
          totalItems: parsed.issues.length,
          config: {
            format: JIRA_JOB_FORMAT,
            analyzeId: input.analyzeId,
            projectId: input.projectId ?? null,
            newProject: input.newProject ?? null,
            mapping: input.mapping,
            options: input.options,
          },
        },
        select: { id: true },
      });
    } catch (err) {
      await this.unclaim(input.analyzeId); // chưa có job nào → cho người dùng thử lại
      throw err;
    }

    const ctx: RunContext = {
      workspaceId,
      userId,
      jobId: job.id,
      analyzeId: input.analyzeId,
      parsed,
      input,
      catalog,
      existingProject,
    };
    const task = this.execute(ctx).finally(() => this.running.delete(job.id));
    this.running.set(job.id, task);
    return { jobId: job.id };
  }

  /** Chờ job nền kết thúc (test và graceful shutdown). */
  async waitForJob(jobId: string): Promise<void> {
    await this.running.get(jobId);
  }

  // ---------------------------------------------------------------- thực thi nền

  /** Chạy toàn bộ import. Không bao giờ ném: mọi lỗi được ghi vào ImportJob. */
  private async execute(ctx: RunContext): Promise<void> {
    const { workspaceId, userId, jobId, parsed, input } = ctx;
    const opts = input.options;
    // Heartbeat nền: giữ `updatedAt` mới kể cả khi một bước (tạo project, một lô lớn) kéo dài, để
    // job đang chạy thật không bị node khác coi là kẹt.
    const heartbeat = setInterval(() => void this.touchJob(jobId), HEARTBEAT_MS);
    heartbeat.unref();
    try {
      // 1. Project đích.
      let projectId: string;
      let projectKey: string;
      let workflowId: string | null;
      if (ctx.existingProject) {
        ({ id: projectId, key: projectKey } = ctx.existingProject);
        workflowId = ctx.existingProject.defaultWorkflowId;
      } else {
        const np = input.newProject!;
        const created = await this.projects.create(workspaceId, userId, {
          key: np.key,
          name: np.name,
          type: 'SCRUM',
        });
        projectId = created.id;
        projectKey = np.key;
        const p = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { defaultWorkflowId: true },
        });
        workflowId = p?.defaultWorkflowId ?? null;
      }
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { config: this.configWith(input, { projectId, projectKey }) },
      });

      // 2. Đổi mapping thành id thật (tạo mới loại/ưu tiên/trạng thái khi người dùng chọn "Tạo mới").
      const typeIds = await this.resolveTypes(workspaceId, input.mapping.issueTypes, ctx.catalog);
      const priorityIds = await this.resolvePriorities(
        workspaceId,
        input.mapping.priorities,
        ctx.catalog,
      );
      const { statusIds, categories } = await this.resolveStatuses(
        projectId,
        workflowId,
        input.mapping.statuses,
      );

      // 3. Sprint.
      const plan = this.plan(parsed, input, ctx.catalog);
      const sprintIds = opts.importSprints
        ? await this.ensureSprints(projectId, parsed, plan.sprintNames)
        : new Map<string, string>();

      // 4. Cache label theo project + tra cứu user/resolution.
      const labelRows = await this.prisma.label.findMany({
        where: { projectId },
        select: { id: true, name: true },
      });
      const labelCache = new Map(labelRows.map((l) => [l.name.toLowerCase(), l.id]));
      const resolutionByName = new Map(
        ctx.catalog.resolutions.map((r) => [r.name.toLowerCase(), r.id]),
      );
      const userFor = (name: string): string | undefined =>
        ownValue(input.mapping.users, name) || undefined; // '' = để trống như null

      // 5. Ghi theo tầng; mỗi tầng chia lô 100 dòng/transaction trong ImportService.
      const idByRow = new Map<JiraIssueRow, string>();
      const rowByNo = new Map(parsed.issues.map((r) => [r.row, r]));
      const errorLines: string[] = [];
      const counters = {
        created: 0,
        failed: 0,
        labels: 0,
        comments: 0,
        warnings: 0,
        duplicates: 0,
        invalid: 0,
      };
      // Mã Jira gốc (L27): tra một lần trước khi ghi theo lô — dòng trùng bỏ qua, dòng sai dạng dùng mã Tirapro.
      const keyPlan = opts.keepJiraKey
        ? // Nhật ký job đọc được qua `import:run` (rộng hơn quản trị): không nêu mã dự án khác (có thể là dự án riêng tư).
          await this.planKeys(workspaceId, parsed.issues, {
            revealProjects: false,
            targetProjectId: projectId,
          })
        : NO_KEY_PLAN();
      // Người phụ trách Jira không được gán: không khớp (cảnh báo) hoặc chủ động "Để trống" (trung tính) — đếm theo việc ĐÃ tạo được.
      const assigneeTally = newAssigneeTally();
      let processed = 0;
      const total = parsed.issues.length;
      const hooks = {
        onChunk: async (n: number): Promise<void> => {
          processed += n;
          await this.prisma.importJob.update({
            where: { id: jobId },
            data: {
              processedItems: processed,
              progress: total ? Math.min(99, Math.floor((processed / total) * 100)) : 0,
            },
          });
        },
      };

      for (const layer of plan.layers) {
        const items: PreparedItem[] = [];
        let skippedInLayer = 0;
        for (const row of layer) {
          const dup = keyPlan.skip.get(row);
          if (dup) {
            errorLines.push(this.line(row, dup.message, true));
            counters.warnings++;
            counters.duplicates++;
            skippedInLayer++;
            // Việc đã có CÙNG dự án đích (còn sống) làm cha/epic cho dòng con ở tầng sau.
            if (dup.existing && !dup.existing.deleted && dup.existing.projectId === projectId)
              idByRow.set(row, dup.existing.id);
            continue;
          }
          const invalidKey = keyPlan.invalid.get(row);
          if (invalidKey) {
            errorLines.push(this.line(row, invalidKey, true));
            counters.warnings++;
            counters.invalid++;
          }
          const links = plan.links.get(row)!;
          for (const w of links.warnings) {
            errorLines.push(this.line(row, w, true));
            counters.warnings++;
          }
          const parentId = links.parent ? idByRow.get(links.parent) : undefined;
          const epicId = links.epic ? idByRow.get(links.epic) : undefined;
          if (links.parent && !parentId) {
            errorLines.push(
              this.line(
                row,
                `Việc cha ${links.parent.key} không được tạo — tạo không có việc cha`,
                true,
              ),
            );
            counters.warnings++;
          }
          if (links.epic && !epicId) {
            errorLines.push(
              this.line(row, `Epic ${links.epic.key} không được tạo — tạo không gắn epic`, true),
            );
            counters.warnings++;
          }
          items.push(
            this.buildItem({
              row,
              projectId,
              parentId,
              epicId,
              typeId: typeIds.get(row.issueType)!,
              statusId: statusIds.get(row.status)!,
              category: categories.get(row.status) ?? 'IN_PROGRESS',
              priorityId: row.priority ? priorityIds.get(row.priority) : undefined,
              sprintId: opts.importSprints
                ? sprintIds.get(row.sprints[row.sprints.length - 1] ?? '')
                : undefined,
              fixedKey: keyPlan.fixed.get(row),
              workspaceId,
              pendingEmail: row.assignee
                ? pendingEmailFor(row.assignee, input.mapping.users, input.mapping.pendingEmails)
                : undefined,
              assigneeId: row.assignee ? userFor(row.assignee) : undefined,
              reporterId: row.reporter ? userFor(row.reporter) : undefined,
              resolutionByName,
              options: opts,
              parsed,
              userFor,
              onCreated: (dto) => {
                idByRow.set(row, dto.id);
                tallyAssignee(
                  assigneeTally,
                  row.assignee,
                  input.mapping.users,
                  input.mapping.pendingEmails,
                );
              },
            }),
          );
        }
        if (skippedInLayer) await hooks.onChunk(skippedInLayer); // dòng bỏ qua vẫn tính vào tiến độ
        const written = await this.importService.createIssuesInChunks(
          workspaceId,
          userId,
          items,
          labelCache,
          hooks,
        );
        counters.created += written.created;
        counters.labels += written.labels;
        counters.comments += written.comments;
        // Lọt qua bước tra mã (hai lượt nhập đồng thời cùng mã): coi là trùng, không phải lỗi.
        for (const d of written.duplicates) {
          counters.duplicates++;
          counters.warnings++;
          const r = rowByNo.get(d.row);
          const msg = 'Mã vừa được một lượt nhập khác tạo — bỏ qua';
          errorLines.push(r ? this.line(r, msg, true) : `Dòng ${d.row} [Cảnh báo]: ${msg}`);
        }
        for (const e of written.errors) {
          counters.failed++;
          const r = rowByNo.get(e.row);
          errorLines.push(r ? this.line(r, e.error, false) : `Dòng ${e.row}: ${e.error}`);
        }
      }

      // 5b. Báo người phụ trách bị bỏ gán (một dòng gộp, không mỗi việc một dòng).
      const unmatched = summarizeUnmatchedAssignees(assigneeTally.unmatched);
      // L28: người đã nhớ email → ghi chú (KHÔNG phải cảnh báo): việc của họ sẽ tự gán khi họ được thêm vào workspace.
      const remembered = summarizeRemembered(assigneeTally.remembered);
      // (không nêu email: result/errorLog đọc được qua `import:run`; wizard tự giữ email vừa nhập để hiển thị)
      if (remembered) errorLines.unshift(`[Ghi chú]: ${formatRemembered(remembered)}`);
      if (unmatched) {
        // Đặt ĐẦU nhật ký: dòng gộp này không bị `joinLog` cắt khi có hàng nghìn dòng lỗi.
        errorLines.unshift(`[Cảnh báo]: ${formatUnmatchedAssignees(unmatched)}`);
        counters.warnings++;
      }

      // 6. Tổng kết.
      const status: 'COMPLETED' | 'FAILED' =
        counters.created === 0 && total - counters.duplicates > 0 ? 'FAILED' : 'COMPLETED';
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status,
          progress: 100,
          processedItems: processed,
          completedAt: new Date(),
          result: {
            projectId,
            projectKey,
            created: counters.created,
            failed: counters.failed,
            warnings: counters.warnings,
            skippedAssignees: (unmatched?.skipped ?? 0) + (remembered?.total ?? 0),
            rememberedAssignees: remembered?.total ?? 0,
            unmatchedAssignees: unmatched?.listed ?? [],
            unmatchedAssigneesMore: unmatched?.more ?? 0,
            blankedAssignees: assigneeTally.blank,
            epics: plan.epics,
            subtasks: plan.subtasks,
            sprints: opts.importSprints ? plan.sprintNames.length : 0,
            labels: counters.labels,
            comments: counters.comments,
            duplicateKeys: counters.duplicates,
            invalidKeys: counters.invalid,
          },
          errorLog: this.joinLog(errorLines),
        },
      });
    } catch (err) {
      const message = this.errMessage(err);
      this.logger.error(`Import Jira thất bại (job ${jobId}): ${message}`);
      try {
        await this.prisma.importJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', errorLog: message, completedAt: new Date() },
        });
      } catch (updateErr) {
        this.logger.error(
          `Không ghi được trạng thái FAILED của job ${jobId}: ${this.errMessage(updateErr)}`,
        );
      }
    } finally {
      clearInterval(heartbeat);
      await this.removeFiles(ctx.analyzeId);
    }
  }

  /** Dựng một PreparedItem: input tạo issue + bước `after` chạy trong cùng transaction. */
  private buildItem(a: {
    row: JiraIssueRow;
    projectId: string;
    parentId?: string;
    epicId?: string;
    typeId: string;
    statusId: string;
    category: Category;
    priorityId?: string;
    sprintId?: string;
    /** Mã Jira gốc làm `Issue.key` (đã kiểm định dạng + trùng). */
    fixedKey?: string;
    workspaceId: string;
    /** Email đã nhớ cho người phụ trách chưa ghép (L28) → ghi hàng chờ trong cùng transaction. */
    pendingEmail?: string;
    assigneeId?: string;
    reporterId?: string;
    resolutionByName: Map<string, string>;
    options: JiraImportOptions;
    parsed: JiraParseResult;
    userFor: (name: string) => string | undefined;
    onCreated: PreparedItem['onCreated'];
  }): PreparedItem {
    const { row, options } = a;

    // Summary Jira có thể dài hơn cột 255 ký tự của Tirapro → cắt và giữ bản đầy đủ trong mô tả.
    const longSummary = row.summary.length > SUMMARY_MAX;
    const summary = longSummary ? `${row.summary.slice(0, SUMMARY_MAX - 1)}…` : row.summary;
    const descParts: string[] = [];
    if (longSummary) descParts.push(`Tiêu đề gốc: ${row.summary}`);
    if (row.description) descParts.push(row.description);

    const input: CreateIssueInput = {
      projectId: a.projectId,
      typeId: a.typeId,
      summary,
      description: descParts.length ? descParts.join('\n\n') : null,
      descriptionFormat: 'MARKDOWN',
      statusId: a.statusId,
      priorityId: a.priorityId,
      assigneeId: a.assigneeId,
      parentId: a.parentId,
      epicId: a.epicId,
      sprintId: a.sprintId,
      storyPoints: row.storyPoints ?? undefined,
      dueDate: row.dueDate ? row.dueDate.toISOString() : undefined,
    };

    return {
      row: row.row,
      input,
      fixedKey: a.fixedKey,
      onCreated: a.onCreated,
      after: async (tx, issue, labelCache) => {
        // 1. Các field IssuesService.create không nhận: ngày gốc, thời gian, người báo cáo, resolution.
        //    assigneeId ghi lại tường minh để "Để trống" thật sự trống (không bị gán lead mặc định).
        const done = a.category === 'DONE';
        const data: Prisma.IssueUncheckedUpdateInput = {
          assigneeId: a.assigneeId ?? null,
          timeSpent: row.timeSpent !== null ? Math.round(row.timeSpent) : null,
          originalEstimate: row.originalEstimate !== null ? Math.round(row.originalEstimate) : null,
          resolvedAt: done ? (row.resolved ?? row.updated ?? null) : null,
          resolutionId:
            done && row.resolution
              ? (a.resolutionByName.get(row.resolution.toLowerCase()) ?? null)
              : null,
        };
        if (row.created) data.createdAt = row.created;
        if (row.updated) data.updatedAt = row.updated;
        if (a.reporterId) data.reporterId = a.reporterId;
        await tx.issue.update({ where: { id: issue.id }, data });

        // 1b. Người phụ trách chưa là thành viên nhưng đã nhớ email: ghi hàng chờ để tự gán khi họ được thêm vào.
        if (a.pendingEmail) {
          await tx.importPendingAssignee.create({
            data: {
              workspaceId: a.workspaceId,
              projectId: a.projectId,
              issueId: issue.id,
              email: a.pendingEmail,
              sourceName: row.assignee,
            },
          });
        }

        // 2. Label (resolve-or-create theo project, dùng cache của lô).
        const labelIds = new Set<string>();
        for (const name of row.labels) {
          labelIds.add(
            await this.importService.resolveOrCreateLabel(tx, a.projectId, name, labelCache),
          );
        }
        if (labelIds.size) {
          await tx.issueLabel.createMany({
            data: [...labelIds].map((labelId) => ({ issueId: issue.id, labelId })),
            skipDuplicates: true,
          });
        }

        // 3. Comment: tác giả chưa ghép → authorId null, ghi tên Jira vào nội dung để không mất dấu.
        let comments = 0;
        if (options.importComments && row.comments.length) {
          const rows: Prisma.CommentCreateManyInput[] = row.comments.map((c) => {
            const name = commentAuthorName(a.parsed, c.authorRef);
            const authorId = name ? a.userFor(name) : undefined;
            const body =
              !authorId && name ? `_(Bình luận từ Jira của ${name})_\n\n${c.body}` : c.body;
            return {
              issueId: issue.id,
              authorId: authorId ?? null,
              body,
              bodyFormat: 'MARKDOWN',
              ...(c.createdAt ? { createdAt: c.createdAt } : {}),
            };
          });
          await tx.comment.createMany({ data: rows });
          comments = rows.length;
        }
        return { labels: labelIds.size, comments };
      },
    };
  }

  // ---------------------------------------------------------------- mapping → id

  private async resolveTypes(
    workspaceId: string,
    mapping: Record<string, string>,
    catalog: Catalog,
  ): Promise<Map<string, string>> {
    const byName = new Map(catalog.types.map((t) => [t.name.toLowerCase(), t.id]));
    const out = new Map<string, string>();
    let epicKeyTaken = false; // đã tạo loại key EPIC trong lượt này
    for (const [jiraName, target] of Object.entries(mapping)) {
      if (target !== JIRA_CREATE) {
        out.set(jiraName, target);
        continue;
      }
      let id = byName.get(jiraName.toLowerCase());
      if (!id) {
        // Loại Epic tạo mới phải thật sự là Epic của Tirapro (level 1; key EPIC nếu workspace chưa có loại key đó).
        const isEpic = isEpicTypeName(jiraName);
        const hasEpicKey = catalog.types.some((t) => t.key === 'EPIC') || epicKeyTaken;
        const created = await this.prisma.issueType.create({
          data: {
            workspaceId,
            name: jiraName,
            isSubtask: isSubtaskTypeName(jiraName),
            ...(isEpic
              ? { hierarchyLevel: 1, ...(hasEpicKey ? {} : { key: 'EPIC' as const }) }
              : {}),
          },
          select: { id: true },
        });
        if (isEpic) epicKeyTaken = true;
        id = created.id;
        byName.set(jiraName.toLowerCase(), id);
      }
      out.set(jiraName, id);
    }
    return out;
  }

  private async resolvePriorities(
    workspaceId: string,
    mapping: Record<string, string>,
    catalog: Catalog,
  ): Promise<Map<string, string>> {
    const byName = new Map(catalog.priorities.map((p) => [p.name.toLowerCase(), p.id]));
    const out = new Map<string, string>();
    for (const [jiraName, target] of Object.entries(mapping)) {
      if (target !== JIRA_CREATE) {
        out.set(jiraName, target);
        continue;
      }
      let id = byName.get(jiraName.toLowerCase());
      if (!id) {
        const created = await this.prisma.priority.create({
          data: { workspaceId, name: jiraName, rank: inferPriorityRank(jiraName) },
          select: { id: true },
        });
        id = created.id;
        byName.set(jiraName.toLowerCase(), id);
      }
      out.set(jiraName, id);
    }
    return out;
  }

  /**
   * Trạng thái thuộc workflow của project. "Tạo mới" = khớp tên có sẵn, thiếu thì tạo kèm
   * transition từ mọi trạng thái (để di chuyển được) và cột trên các board của project.
   */
  private async resolveStatuses(
    projectId: string,
    workflowId: string | null,
    mapping: Record<string, string>,
  ): Promise<{ statusIds: Map<string, string>; categories: Map<string, Category> }> {
    if (!workflowId)
      throw new BusinessRuleException(
        'Project chưa cấu hình workflow — hãy tạo workflow cho project trước khi nhập',
      );
    const existing = await this.prisma.status.findMany({
      where: { workflowId },
      select: { id: true, name: true, category: true },
    });
    const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
    const byId = new Map(existing.map((s) => [s.id, s]));
    const statusIds = new Map<string, string>();
    const categories = new Map<string, Category>();
    let nextOrder: number | null = null;

    for (const [jiraName, target] of Object.entries(mapping)) {
      if (target !== JIRA_CREATE) {
        statusIds.set(jiraName, target);
        categories.set(jiraName, byId.get(target)?.category ?? 'IN_PROGRESS');
        continue;
      }
      let status = byName.get(jiraName.toLowerCase());
      if (!status) {
        if (nextOrder === null) {
          const agg = await this.prisma.status.aggregate({
            where: { workflowId },
            _max: { order: true },
          });
          nextOrder = (agg._max.order ?? -1) + 1;
        }
        const category = inferStatusCategory(jiraName);
        const created = await this.prisma.status.create({
          data: { workflowId, name: jiraName, category, order: nextOrder++, isInitial: false },
          select: { id: true },
        });
        status = { id: created.id, name: jiraName, category };
        byName.set(jiraName.toLowerCase(), status);
        await this.prisma.workflowTransition.create({
          data: { workflowId, name: `→ ${jiraName}`, fromStatusId: null, toStatusId: created.id },
        });
        await this.addToBoards(projectId, jiraName, created.id);
      }
      statusIds.set(jiraName, status.id);
      categories.set(jiraName, status.category);
    }
    return { statusIds, categories };
  }

  /** Thêm cột (cùng tên trạng thái) vào từng board của project để trạng thái mới hiện trên board. */
  private async addToBoards(projectId: string, name: string, statusId: string): Promise<void> {
    const boards = await this.prisma.board.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true },
    });
    for (const b of boards) {
      let col = await this.prisma.boardColumn.findFirst({
        where: { boardId: b.id, name },
        select: { id: true },
      });
      if (!col) {
        const last = await this.prisma.boardColumn.findFirst({
          where: { boardId: b.id },
          orderBy: { order: 'desc' },
          select: { order: true },
        });
        col = await this.prisma.boardColumn.create({
          data: { boardId: b.id, name, order: (last?.order ?? -1) + 1 },
          select: { id: true },
        });
      }
      await this.prisma.boardColumnStatus.upsert({
        where: { columnId_statusId: { columnId: col.id, statusId } },
        update: {},
        create: { columnId: col.id, statusId },
      });
    }
  }

  /** Sprint CLOSED theo tên (dùng lại sprint cùng tên đã có); ngày = khoảng tạo→cập nhật của các issue trong sprint. */
  private async ensureSprints(
    projectId: string,
    parsed: JiraParseResult,
    names: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!names.length) return out;
    const existing = await this.prisma.sprint.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, name: true },
    });
    const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s.id]));
    // allow-deleted: sequence phải tính cả sprint đã xoá để không trùng số thứ tự (unique projectId+sequence)
    const last = await this.prisma.sprint.findFirst({
      where: { projectId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    let sequence = last?.sequence ?? 0;

    for (const name of names) {
      const known = byName.get(name.toLowerCase());
      if (known) {
        out.set(name, known);
        continue;
      }
      const rows = parsed.issues.filter((r) => r.sprints.includes(name));
      const starts = rows
        .map((r) => r.created?.getTime())
        .filter((t): t is number => t !== undefined);
      const ends = rows
        .map((r) => (r.resolved ?? r.updated)?.getTime())
        .filter((t): t is number => t !== undefined);
      const startDate = starts.length ? new Date(Math.min(...starts)) : null;
      const endDate = ends.length ? new Date(Math.max(...ends)) : null;
      const sprint = await this.prisma.sprint.create({
        data: {
          projectId,
          name,
          state: 'CLOSED',
          sequence: ++sequence,
          startDate,
          endDate,
          completeDate: endDate,
        },
        select: { id: true },
      });
      out.set(name, sprint.id);
    }
    return out;
  }

  // ---------------------------------------------------------------- kiểm tra + kế hoạch

  private async loadCatalog(workspaceId: string): Promise<Catalog> {
    const [types, priorities, resolutions, members] = await Promise.all([
      this.prisma.issueType.findMany({
        where: { workspaceId },
        select: { id: true, name: true, key: true, isSubtask: true },
      }),
      this.prisma.priority.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
      this.prisma.resolution.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
      this.prisma.workspaceMembership.findMany({
        where: { workspaceId },
        select: { userId: true },
      }),
    ]);
    return { types, priorities, resolutions, memberIds: new Set(members.map((m) => m.userId)) };
  }

  /** Mọi id được chọn phải thuộc workspace (loại/ưu tiên/người dùng) hoặc workflow của project (trạng thái). */
  private assertTargets(
    input: JiraImportRunInput,
    catalog: Catalog,
    statuses: Array<{ id: string; name: string }>,
    hasProject: boolean,
  ): void {
    const bad: string[] = [];
    const typeIds = new Set(catalog.types.map((t) => t.id));
    const priorityIds = new Set(catalog.priorities.map((p) => p.id));
    const statusIds = new Set(statuses.map((s) => s.id));
    for (const [name, id] of Object.entries(input.mapping.issueTypes)) {
      if (id !== JIRA_CREATE && !typeIds.has(id)) bad.push(`loại "${name}" → ${id} không tồn tại`);
    }
    for (const [name, id] of Object.entries(input.mapping.priorities)) {
      if (id !== JIRA_CREATE && !priorityIds.has(id))
        bad.push(`ưu tiên "${name}" → ${id} không tồn tại`);
    }
    for (const [name, id] of Object.entries(input.mapping.statuses)) {
      if (id === JIRA_CREATE) continue;
      if (!hasProject)
        bad.push(
          `trạng thái "${name}": project mới chưa có trạng thái nào để chọn — hãy chọn "Tạo mới"`,
        );
      else if (!statusIds.has(id))
        bad.push(`trạng thái "${name}" → ${id} không thuộc workflow của dự án`);
    }
    for (const [name, id] of Object.entries(input.mapping.users)) {
      if (id !== null && id !== '' && !catalog.memberIds.has(id))
        bad.push(`người dùng "${name}" → ${id} không phải thành viên workspace`);
    }
    if (bad.length)
      throw new BusinessRuleException(
        `Mapping có giá trị không hợp lệ — hãy chọn lại: ${bad.join('; ')}`,
      );
  }

  /** Phân loại epic/subtask, resolve cha/epic và chia tầng; đếm số liệu cho dry-run. */
  private plan(
    parsed: JiraParseResult,
    input: JiraImportRunInput,
    catalog: Pick<Catalog, 'types'>,
  ): Plan {
    const typeById = new Map(catalog.types.map((t) => [t.id, t]));
    const mapped = (r: JiraIssueRow) => {
      const target = ownValue(input.mapping.issueTypes, r.issueType);
      return target && target !== JIRA_CREATE ? typeById.get(target) : undefined;
    };
    const isEpic = (r: JiraIssueRow): boolean =>
      isEpicTypeName(r.issueType) || mapped(r)?.key === 'EPIC';
    const isSubtask = (r: JiraIssueRow): boolean =>
      isSubtaskTypeName(r.issueType) || mapped(r)?.isSubtask === true;

    const rows = parsed.issues;
    const links = resolveLinks(rows, isEpic, isSubtask);
    const layers = layerIssues(rows, links, isEpic, isSubtask);
    const sprintNames = [...new Set(rows.flatMap((r) => r.sprints))];
    return {
      links,
      layers,
      isEpic,
      isSubtask,
      epics: rows.filter(isEpic).length,
      subtasks: rows.filter(isSubtask).length,
      sprintNames,
      labels: new Set(rows.flatMap((r) => r.labels.map((l) => l.toLowerCase()))).size,
      comments: rows.reduce((n, r) => n + r.comments.length, 0),
    };
  }

  // ---------------------------------------------------------------- tệp phân tích

  private dir(): string {
    return path.join(this.localDir, 'imports');
  }

  /** Đọc + parse tệp đã analyze; kiểm tra thuộc workspace và chưa hết hạn. */
  private async load(workspaceId: string, analyzeId: string): Promise<JiraParseResult> {
    if (!jiraAnalyzeIdSchema.safeParse(analyzeId).success)
      throw new BusinessRuleException(EXPIRED_MESSAGE);
    const csvPath = path.join(this.dir(), `${analyzeId}.csv`);
    try {
      const [stat, metaRaw] = await Promise.all([
        fs.stat(csvPath),
        fs.readFile(path.join(this.dir(), `${analyzeId}.json`), 'utf8'),
      ]);
      const meta = JSON.parse(metaRaw) as AnalyzeMeta;
      if (meta.workspaceId !== workspaceId) throw new Error('khác workspace');
      if (Date.now() - stat.mtimeMs > ANALYZE_TTL_MS) {
        await this.removeFiles(analyzeId);
        throw new Error('hết hạn');
      }
      return await parseJiraCsvAsync(await fs.readFile(csvPath));
    } catch {
      // Có `.claimed` ⇒ phiên này đã/đang được import, khác với hết hạn/không tồn tại.
      const claimed = await fs
        .access(path.join(this.dir(), `${analyzeId}.claimed`))
        .then(() => true)
        .catch(() => false);
      throw new BusinessRuleException(claimed ? ALREADY_RUN_MESSAGE : EXPIRED_MESSAGE);
    }
  }

  /** Claim nguyên tử: chỉ MỘT request đổi tên được `<id>.json` → `<id>.claimed` (ENOENT ⇒ đã bị claim). */
  private async claim(analyzeId: string): Promise<void> {
    try {
      await fs.rename(
        path.join(this.dir(), `${analyzeId}.json`),
        path.join(this.dir(), `${analyzeId}.claimed`),
      );
    } catch (err) {
      // ENOENT = tệp `.json` không còn ⇒ request khác đã claim. Lỗi khác (EACCES, EIO…) là sự cố thật.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new BusinessRuleException(ALREADY_RUN_MESSAGE);
      throw err;
    }
  }

  /** Nhả claim khi chưa tạo được job để người dùng bấm "Chạy" lại. */
  private async unclaim(analyzeId: string): Promise<void> {
    await fs
      .rename(
        path.join(this.dir(), `${analyzeId}.claimed`),
        path.join(this.dir(), `${analyzeId}.json`),
      )
      .catch(() => undefined);
  }

  /** Xoá tệp phân tích quá 1 giờ (gọi ở mỗi lần analyze — không cần cron). */
  private async purgeExpired(): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir());
    } catch {
      return; // chưa có thư mục
    }
    const now = Date.now();
    for (const name of names) {
      const full = path.join(this.dir(), name);
      try {
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs > ANALYZE_TTL_MS) await fs.unlink(full);
      } catch {
        // tệp biến mất giữa chừng — bỏ qua
      }
    }
  }

  private async removeFiles(analyzeId: string): Promise<void> {
    if (!jiraAnalyzeIdSchema.safeParse(analyzeId).success) return; // không bao giờ unlink theo id lạ (path traversal)
    for (const ext of ['csv', 'json', 'claimed']) {
      await fs.unlink(path.join(this.dir(), `${analyzeId}.${ext}`)).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- helpers

  private configWith(
    input: JiraImportRunInput,
    extra: Record<string, string>,
  ): Prisma.InputJsonValue {
    return {
      format: JIRA_JOB_FORMAT,
      analyzeId: input.analyzeId,
      mapping: input.mapping,
      options: input.options,
      ...extra,
    };
  }

  /**
   * Quyết định mã cho từng dòng khi giữ mã Jira (L27). Kiểm trùng bằng truy vấn trước + `Set` trong lượt, KHÔNG dựa
   * vào bắt P2002 trong transaction (Postgres huỷ cả transaction sau lỗi unique). Trùng = bỏ qua (idempotent, không
   * ghi đè chỉnh sửa người dùng đã làm trên Tirapro): mã đang có trong workspace (mọi dự án, kể cả đã xoá mềm) hoặc
   * mã lặp lại trong chính tệp (dòng sau bị bỏ). Mã sai dạng `KEY-123` → không dùng làm mã, việc vẫn được tạo.
   */
  private async planKeys(
    workspaceId: string,
    rows: JiraIssueRow[],
    scope: { revealProjects: boolean; targetProjectId?: string },
  ): Promise<KeyPlan> {
    const plan = NO_KEY_PLAN();
    const normalized = new Map<JiraIssueRow, string>();
    for (const r of rows) {
      const key = normalizeJiraKey(r.key);
      if (key) normalized.set(r, key);
      else
        plan.invalid.set(
          r,
          r.key
            ? `Mã "${r.key}" không đúng dạng KEY-123 — tạo bằng mã Tirapro tự sinh`
            : 'Dòng không có mã Jira — tạo bằng mã Tirapro tự sinh',
        );
    }
    const keys = [...new Set(normalized.values())];
    const existing = new Map<string, ExistingKey>();
    for (let i = 0; i < keys.length; i += KEY_LOOKUP_CHUNK) {
      const found = await this.prisma.issue.findMany({
        // allow-deleted: việc đã xoá mềm vẫn giữ mã → vẫn trùng unique (workspaceId, key)
        where: { workspaceId, key: { in: keys.slice(i, i + KEY_LOOKUP_CHUNK) } },
        select: {
          id: true,
          key: true,
          projectId: true,
          deletedAt: true,
          project: { select: { key: true } },
        },
      });
      for (const f of found)
        existing.set(f.key, {
          id: f.id,
          key: f.key,
          projectId: f.projectId,
          projectKey: f.project.key,
          deleted: f.deletedAt !== null,
        });
    }
    const firstRow = new Map<string, JiraIssueRow>();
    for (const [row, key] of normalized) {
      const had = existing.get(key);
      if (had) {
        const where =
          scope.targetProjectId === had.projectId
            ? 'dự án này'
            : scope.revealProjects
              ? `dự án ${had.projectKey}`
              : 'một dự án khác';
        plan.skip.set(row, {
          existing: had,
          message: had.deleted
            ? `Mã ${key} đã tồn tại (việc đã xoá, nằm trong Thùng rác của ${where}) — bỏ qua`
            : `Mã ${key} đã tồn tại (ở ${where}) — bỏ qua`,
        });
        continue;
      }
      const first = firstRow.get(key);
      if (first) {
        plan.skip.set(row, {
          message: `Mã ${key} lặp lại trong tệp (đã dùng ở dòng ${first.row}) — bỏ qua dòng này`,
        });
        continue;
      }
      firstRow.set(key, row);
      plan.fixed.set(row, key);
    }
    return plan;
  }

  /** Cảnh báo dạng chữ (dry-run) từ kế hoạch mã, theo thứ tự dòng. */
  private keyWarnings(plan: KeyPlan): string[] {
    const lines: Array<[JiraIssueRow, string]> = [
      ...[...plan.skip].map(([r, v]) => [r, v.message] as [JiraIssueRow, string]),
      ...plan.invalid,
    ];
    return lines.sort((a, b) => a[0].row - b[0].row).map(([r, m]) => this.line(r, m, true));
  }

  /**
   * Dry-run về người phụ trách: dòng cảnh báo gộp cho người sẽ bị bỏ gán (không khớp, không có email) và dòng ghi chú
   * cho người đã nhớ email (sẽ tự gán khi họ được thêm vào workspace); kèm số việc của nhóm sau.
   */
  private dryRunAssignees(
    rows: JiraIssueRow[],
    mapping: JiraImportRunInput['mapping'],
  ): { lines: string[]; remembered: number } {
    const tally = newAssigneeTally();
    for (const r of rows) tallyAssignee(tally, r.assignee, mapping.users, mapping.pendingEmails);
    const u = summarizeUnmatchedAssignees(tally.unmatched);
    const rem = summarizeRemembered(tally.remembered);
    return {
      lines: [
        ...(u ? [formatUnmatchedAssignees(u)] : []),
        ...(rem ? [formatRemembered(rem, true)] : []),
      ],
      remembered: rem?.total ?? 0,
    };
  }

  /** "Dòng 5 (ABC-12): lý do" / "Dòng 5 (ABC-12) [Cảnh báo]: lý do". */
  private line(row: JiraIssueRow, message: string, warning: boolean): string {
    return `Dòng ${row.row} (${row.key || 'không có mã'})${warning ? ' [Cảnh báo]' : ''}: ${message}`;
  }

  private joinLog(lines: string[]): string | null {
    if (!lines.length) return null;
    if (lines.length <= MAX_ERROR_LOG_LINES) return lines.join('\n');
    const rest = lines.length - MAX_ERROR_LOG_LINES;
    return [...lines.slice(0, MAX_ERROR_LOG_LINES), `… và ${rest} dòng nữa`].join('\n');
  }

  private errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
