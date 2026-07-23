import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import type { CreateIssueInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { IssuesService } from '../issues/issues.service';

/** Một dòng CSV đã parse: key = header (giữ nguyên), value = chuỗi. */
type CsvRow = Record<string, string>;

/** Lỗi của một dòng khi import. */
interface RowError {
  row: number;
  error: string;
}

export interface ImportCsvInput {
  projectId: string;
  csv: string;
}

export interface ImportCsvResult {
  jobId: string;
  source: 'CSV';
  created: number;
  failed: number;
  total: number;
  errors: RowError[];
}

/** Một comment trong bản export JSON (chỉ dùng các field round-trippable). */
interface ExportComment {
  author: string | null;
  body: string;
  createdAt?: string;
}

/** Một issue trong bản export JSON (đối chiếu ProjectExport của Export module). */
interface ExportIssue {
  key?: string;
  summary?: string;
  description?: string | null;
  type?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  reporter?: string | null;
  storyPoints?: number | null;
  sprint?: string | null;
  labels?: string[];
  comments?: ExportComment[];
}

/** Bản export JSON do Export module sinh ra (chỉ khai báo field mà import cần). */
interface ExportData {
  issues: ExportIssue[];
}

export interface ImportJsonInput {
  projectId: string;
  data: ExportData;
}

export interface ImportJsonResult {
  jobId: string;
  source: 'CSV';
  created: number;
  failed: number;
  total: number;
  errors: RowError[];
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
  ) {}

  /**
   * Import issue từ CSV (hoặc file Jira export) vào một project sẵn có.
   * Tái sử dụng IssuesService.create để đánh số/key/rank/workflow chuẩn xác.
   */
  async importCsv(
    workspaceId: string,
    userId: string,
    { projectId, csv }: ImportCsvInput,
  ): Promise<ImportCsvResult> {
    // 1. Xác minh project thuộc workspace.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Project');

    // 2. Tạo bản ghi ImportJob (RUNNING).
    const job = await this.prisma.importJob.create({
      data: {
        workspaceId,
        source: 'CSV',
        status: 'RUNNING',
        createdById: userId,
        startedAt: new Date(),
        config: { projectId } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    try {
      // 3. Parse CSV thành mảng object theo header.
      const rows = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as CsvRow[];

      // 4. Nạp issue type & priority của workspace, dựng map theo tên (lowercase).
      const [types, priorities] = await Promise.all([
        this.prisma.issueType.findMany({
          where: { workspaceId },
          select: { id: true, name: true },
        }),
        this.prisma.priority.findMany({
          where: { workspaceId },
          select: { id: true, name: true },
        }),
      ]);

      const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t.id]));
      const priorityByName = new Map(
        priorities.map((p) => [p.name.toLowerCase(), p.id]),
      );
      const defaultTypeId = typeByName.get('task') ?? types[0]?.id;

      // 5. Tạo issue cho từng dòng; lỗi từng dòng không làm hỏng cả lần import.
      const errors: RowError[] = [];
      let created = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const get = this.rowAccessor(row);

        const summary = get('summary', 'title');
        if (!summary) continue; // bỏ qua dòng không có tiêu đề.

        try {
          const typeId =
            this.lookup(typeByName, get('type', 'issue type')) ?? defaultTypeId;
          if (!typeId) {
            throw new Error('Không tìm thấy loại issue (issue type) phù hợp');
          }

          const description = get('description');
          const priorityId = this.lookup(priorityByName, get('priority'));
          const storyPoints = this.parseNumber(get('story points', 'points'));

          const input: CreateIssueInput = {
            projectId,
            typeId,
            summary,
            description: description || null,
            descriptionFormat: 'MARKDOWN',
            priorityId: priorityId ?? undefined,
            storyPoints: storyPoints ?? undefined,
          };

          await this.issues.create(workspaceId, userId, input);
          created++;
        } catch (err) {
          errors.push({ row: i, error: this.errMessage(err) });
        }
      }

      // 6. Cập nhật ImportJob.
      const total = rows.length;
      const failed = errors.length;
      const status: 'COMPLETED' | 'FAILED' =
        created === 0 && failed > 0 ? 'FAILED' : 'COMPLETED';

      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status,
          progress: 100,
          totalItems: total,
          processedItems: created,
          completedAt: new Date(),
          result: {
            created,
            failed,
            errors: errors.slice(0, 50),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // 7. Trả tóm tắt.
      return {
        jobId: job.id,
        source: 'CSV',
        created,
        failed,
        total,
        errors: errors.slice(0, 20),
      };
    } catch (err) {
      // Lỗi top-level (vd parse CSV hỏng): đánh dấu FAILED.
      const message = this.errMessage(err);
      this.logger.error(`Import CSV thất bại (job ${job.id}): ${message}`);
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorLog: message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /**
   * Import từ bản export JSON (round-trip với Export module).
   * Tiêu thụ đúng shape ProjectExport: tái tạo issue (qua IssuesService.create),
   * resolve-or-create label theo project, và tái tạo comment.
   * Lỗi từng issue không làm hỏng cả lần import.
   */
  async importJson(
    workspaceId: string,
    userId: string,
    { projectId, data }: ImportJsonInput,
  ): Promise<ImportJsonResult> {
    // 1. Xác minh project thuộc workspace.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Project');

    const issues = Array.isArray(data?.issues) ? data.issues : [];
    const total = issues.length;

    // 2. Tạo bản ghi ImportJob (RUNNING). Không có enum source JSON →
    // dùng CSV và ghi nhận định dạng thực tế qua config.format.
    const job = await this.prisma.importJob.create({
      data: {
        workspaceId,
        source: 'CSV',
        status: 'RUNNING',
        createdById: userId,
        startedAt: new Date(),
        totalItems: total,
        config: { projectId, format: 'json' } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    try {
      // 3. Pre-resolve các lookup của workspace/project.
      const [types, priorities, projectLabels, users] = await Promise.all([
        this.prisma.issueType.findMany({
          where: { workspaceId },
          select: { id: true, name: true },
        }),
        this.prisma.priority.findMany({
          where: { workspaceId },
          select: { id: true, name: true },
        }),
        this.prisma.label.findMany({
          where: { projectId },
          select: { id: true, name: true },
        }),
        this.prisma.user.findMany({
          select: { id: true, email: true },
        }),
      ]);

      const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t.id]));
      const priorityByName = new Map(
        priorities.map((p) => [p.name.toLowerCase(), p.id]),
      );
      // Map label theo tên (lowercase) → id; tạo mới khi thiếu (unique [projectId,name]).
      const labelByName = new Map(
        projectLabels.map((l) => [l.name.toLowerCase(), l.id]),
      );
      const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
      const defaultTypeId = typeByName.get('task') ?? types[0]?.id;

      // 4. Tái tạo từng issue.
      const errors: RowError[] = [];
      let created = 0;
      let commentsCreated = 0;
      let labelsLinked = 0;

      for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const summary = issue?.summary?.trim();
        if (!summary) {
          errors.push({ row: i, error: 'Thiếu summary (tiêu đề) — bỏ qua' });
          continue;
        }

        try {
          const typeId = this.lookup(typeByName, issue.type ?? '') ?? defaultTypeId;
          if (!typeId) {
            throw new Error('Không tìm thấy loại issue (issue type) phù hợp');
          }

          const priorityId = this.lookup(priorityByName, issue.priority ?? '');
          const assigneeId = this.lookupUser(userByEmail, issue.assignee);

          const input: CreateIssueInput = {
            projectId,
            typeId,
            summary,
            description: issue.description ?? null,
            descriptionFormat: 'MARKDOWN',
            priorityId: priorityId ?? undefined,
            assigneeId: assigneeId ?? undefined,
            storyPoints:
              typeof issue.storyPoints === 'number' ? issue.storyPoints : undefined,
          };

          const createdIssue = await this.issues.create(workspaceId, userId, input);

          // 4a. Gắn label: resolve-or-create theo project, chống trùng.
          const labelNames = Array.isArray(issue.labels) ? issue.labels : [];
          for (const rawName of labelNames) {
            const name = typeof rawName === 'string' ? rawName.trim() : '';
            if (!name) continue;
            const labelId = await this.resolveOrCreateLabel(
              projectId,
              name,
              labelByName,
            );
            try {
              await this.prisma.issueLabel.create({
                data: { issueId: createdIssue.id, labelId },
              });
              labelsLinked++;
            } catch {
              // Trùng [issueId,labelId] (label lặp trong export) → bỏ qua.
            }
          }

          // 4b. Tái tạo comment theo thứ tự trong export.
          const comments = Array.isArray(issue.comments) ? issue.comments : [];
          for (const c of comments) {
            const body = typeof c?.body === 'string' ? c.body : '';
            if (!body) continue;
            await this.prisma.comment.create({
              data: {
                issueId: createdIssue.id,
                authorId: this.lookupUser(userByEmail, c.author),
                body,
                bodyFormat: 'MARKDOWN',
              },
            });
            commentsCreated++;
          }

          created++;
        } catch (err) {
          errors.push({ row: i, error: this.errMessage(err) });
        }
      }

      // 5. Cập nhật ImportJob.
      const failed = total - created;
      const status: 'COMPLETED' | 'FAILED' =
        created === 0 && total > 0 ? 'FAILED' : 'COMPLETED';

      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status,
          progress: 100,
          totalItems: total,
          processedItems: created,
          completedAt: new Date(),
          result: {
            created,
            failed,
            comments: commentsCreated,
            labels: labelsLinked,
            errors: errors.slice(0, 50),
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // 6. Trả tóm tắt.
      return {
        jobId: job.id,
        source: 'CSV',
        created,
        failed,
        total,
        errors: errors.slice(0, 20),
      };
    } catch (err) {
      const message = this.errMessage(err);
      this.logger.error(`Import JSON thất bại (job ${job.id}): ${message}`);
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorLog: message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /** Danh sách ImportJob của workspace, mới nhất trước. */
  async listJobs(workspaceId: string, cursor: string | undefined, limit: number) {
    const take = Math.min(Math.max(limit || 20, 1), 100);
    const jobs = await this.prisma.importJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        source: true,
        status: true,
        totalItems: true,
        processedItems: true,
        result: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return jobs.map((j) => ({
      id: j.id,
      source: j.source,
      status: j.status,
      totalItems: j.totalItems,
      processedItems: j.processedItems,
      result: j.result,
      createdAt: j.createdAt.toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
    }));
  }

  // ---------- helpers ----------

  /**
   * Trả về hàm tra cứu giá trị theo header (không phân biệt hoa/thường,
   * chấp nhận nhiều tên thay thế). Trả chuỗi đã trim, '' nếu không có.
   */
  private rowAccessor(row: CsvRow): (...keys: string[]) => string {
    const lower = new Map<string, string>();
    for (const [k, v] of Object.entries(row)) {
      lower.set(k.toLowerCase().trim(), typeof v === 'string' ? v : String(v ?? ''));
    }
    return (...keys: string[]): string => {
      for (const key of keys) {
        const val = lower.get(key.toLowerCase());
        if (val !== undefined && val.trim() !== '') return val.trim();
      }
      return '';
    };
  }

  /** Tra id trong map theo tên (lowercase). undefined nếu rỗng/không khớp. */
  private lookup(map: Map<string, string>, name: string): string | undefined {
    if (!name) return undefined;
    return map.get(name.toLowerCase());
  }

  /** Tra userId theo email (lowercase). undefined nếu rỗng/không khớp. */
  private lookupUser(
    map: Map<string, string>,
    email: string | null | undefined,
  ): string | undefined {
    if (!email) return undefined;
    return map.get(email.toLowerCase());
  }

  /**
   * Resolve-or-create label trong project (label phạm vi project, unique [projectId,name]).
   * Cập nhật cache để các issue sau tái dùng id, tránh tạo trùng.
   */
  private async resolveOrCreateLabel(
    projectId: string,
    name: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const key = name.toLowerCase();
    const existing = cache.get(key);
    if (existing) return existing;

    // upsert chống đua/trùng theo unique [projectId,name].
    const label = await this.prisma.label.upsert({
      where: { projectId_name: { projectId, name } },
      update: {},
      create: { projectId, name },
      select: { id: true },
    });
    cache.set(key, label.id);
    return label.id;
  }

  /** Parse số (story points). undefined nếu rỗng/không hợp lệ. */
  private parseNumber(raw: string): number | undefined {
    if (!raw) return undefined;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }

  private errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
