import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type CreateIssueInput,
  type ExcelImportResult,
  type ExcelPreviewResult,
  type ExcelPreviewRow,
  type ExcelRowIssue,
} from '@tirapro/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { NotFoundAppException } from '../../../common/exceptions/app.exception';
import { assertNotArchived } from '../../../common/project-writable';
import { ImportService, type PreparedItem, type RowError } from '../import.service';
import { EXCEL_COLUMNS, epicLabel, splitMulti, type ExcelColumnKey } from './excel-columns';
import {
  assertXlsxUpload,
  parseExcelBuffer,
  parseExcelDate,
  parseExcelNumber,
  scalarText,
  type RawExcelRow,
} from './excel-parse';
import { buildExcelTemplate, type ProjectCatalog } from './excel-template';

type UploadFile = Parameters<typeof assertXlsxUpload>[0];

const COL: Record<ExcelColumnKey, string> = Object.fromEntries(
  EXCEL_COLUMNS.map((c) => [c.key, c.header]),
) as Record<ExcelColumnKey, string>;

/** Khoá so khớp: bỏ khác biệt hoa/thường và dạng Unicode. */
const norm = (s: string): string => s.normalize('NFC').trim().toLocaleLowerCase('vi');

/** `Tên <email>` hoặc chỉ email → email (chữ thường). */
function personEmail(raw: string): string {
  const m = /<([^<>]+)>\s*$/.exec(raw);
  return norm(m ? m[1]! : raw);
}

interface RowFields {
  typeId: string;
  summary: string;
  description: string;
  priorityId?: string;
  statusId?: string;
  assigneeId?: string;
  reporterId?: string;
  sprintId?: string;
  epicId?: string;
  storyPoints?: number;
  startDate?: string;
  dueDate?: string;
  labelNames: string[];
  componentIds: string[];
  versionId?: string;
}

interface ValidatedRow {
  view: ExcelPreviewRow;
  item?: PreparedItem;
}

interface Analysis {
  catalog: ProjectCatalog;
  total: number;
  rows: ValidatedRow[];
}

const rowMessage = (row: number, e: ExcelRowIssue): string =>
  `Dòng ${row} · ${e.column}: ${e.message}`;

@Injectable()
export class ExcelImportService {
  private readonly logger = new Logger(ExcelImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly importer: ImportService,
  ) {}

  /** Dự án phải thuộc workspace của request; mọi truy vấn danh mục bên dưới theo projectId này. */
  private async loadProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true, key: true, name: true, archivedAt: true, defaultWorkflowId: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    return project;
  }

  private async loadCatalog(
    workspaceId: string,
    project: { id: string; key: string; name: string; defaultWorkflowId: string | null },
  ): Promise<ProjectCatalog> {
    const projectId = project.id;
    const [types, priorities, statuses, memberships, sprints, epics, labels, components, versions] =
      await Promise.all([
        this.prisma.issueType.findMany({
          where: { workspaceId },
          select: { id: true, name: true, key: true, hierarchyLevel: true, isSubtask: true },
          orderBy: [{ hierarchyLevel: 'desc' }, { name: 'asc' }],
        }),
        this.prisma.priority.findMany({
          where: { workspaceId },
          select: { id: true, name: true },
          orderBy: [{ rank: 'desc' }, { name: 'asc' }],
        }),
        this.prisma.status.findMany({
          where: { workflowId: project.defaultWorkflowId ?? '' },
          select: { id: true, name: true, isInitial: true },
          orderBy: { order: 'asc' },
        }),
        this.prisma.projectMembership.findMany({
          where: { projectId, user: { status: 'ACTIVE' } },
          select: { user: { select: { id: true, displayName: true, email: true } } },
        }),
        this.prisma.sprint.findMany({
          where: { projectId, deletedAt: null, state: { in: ['ACTIVE', 'FUTURE'] } },
          select: { id: true, name: true },
          orderBy: { sequence: 'asc' },
        }),
        this.prisma.issue.findMany({
          where: {
            projectId,
            workspaceId,
            deletedAt: null,
            type: { OR: [{ key: 'EPIC' }, { hierarchyLevel: { gte: 1 } }] },
          },
          select: { id: true, key: true, summary: true },
          orderBy: { number: 'asc' },
        }),
        this.prisma.label.findMany({
          where: { projectId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.component.findMany({
          where: { projectId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.version.findMany({
          where: { projectId, status: 'UNRELEASED' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);
    const members = memberships
      .map((m) => m.user)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
    return {
      project: { id: project.id, key: project.key, name: project.name },
      types,
      priorities,
      statuses,
      members,
      sprints,
      epics,
      labels,
      components,
      versions,
    };
  }

  /** GET template — `.xlsx` theo cấu hình hiện tại của dự án. */
  async template(
    workspaceId: string,
    projectId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const project = await this.loadProject(workspaceId, projectId);
    const catalog = await this.loadCatalog(workspaceId, project);
    const buffer = await buildExcelTemplate(catalog);
    return { buffer, filename: `Mau-nhap-cong-viec-${project.key}.xlsx` };
  }

  /** POST preview — không ghi DB. */
  async preview(
    workspaceId: string,
    projectId: string,
    file: UploadFile,
  ): Promise<ExcelPreviewResult> {
    const a = await this.analyze(workspaceId, projectId, file);
    return this.toPreview(a);
  }

  /** POST import — validate lại từ đầu, nhập dòng hợp lệ, bỏ dòng lỗi. */
  async commit(
    workspaceId: string,
    userId: string,
    projectId: string,
    file: UploadFile,
  ): Promise<ExcelImportResult> {
    const a = await this.analyze(workspaceId, projectId, file);

    const job = await this.prisma.importJob.create({
      data: {
        workspaceId,
        source: 'EXCEL',
        status: 'RUNNING',
        createdById: userId,
        startedAt: new Date(),
        totalItems: a.total,
        config: { projectId, format: 'excel' },
      },
      select: { id: true },
    });

    try {
      const errors: RowError[] = [];
      const items: PreparedItem[] = [];
      for (const r of a.rows) {
        if (r.item) items.push(r.item);
        else
          errors.push({
            row: r.view.row,
            error: r.view.errors.map((e) => rowMessage(r.view.row, e)).join('; '),
          });
      }
      const labelCache = new Map(a.catalog.labels.map((l) => [l.name.toLowerCase(), l.id]));
      const written = await this.importer.createIssuesInChunks(
        workspaceId,
        userId,
        items,
        labelCache,
      );
      errors.push(
        ...written.errors.map((e) => ({ row: e.row, error: `Dòng ${e.row}: ${e.error}` })),
      );
      errors.sort((x, y) => x.row - y.row);

      const created = written.created;
      const failed = errors.length;
      const status: 'COMPLETED' | 'FAILED' = created === 0 && failed > 0 ? 'FAILED' : 'COMPLETED';
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status,
          progress: 100,
          totalItems: a.total,
          processedItems: created,
          completedAt: new Date(),
          result: {
            created,
            failed,
            labels: written.labels,
            errors: errors.slice(0, 50),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        jobId: job.id,
        source: 'EXCEL',
        created,
        failed,
        total: a.total,
        errors: errors.slice(0, 20),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Import Excel thất bại (job ${job.id}): ${message}`);
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorLog: message, completedAt: new Date() },
      });
      throw err;
    }
  }

  private toPreview(a: Analysis): ExcelPreviewResult {
    const invalid = a.rows.filter((r) => !r.item).length;
    return {
      total: a.total,
      valid: a.rows.length - invalid,
      invalid,
      rows: a.rows.map((r) => r.view),
    };
  }

  private async analyze(
    workspaceId: string,
    projectId: string,
    file: UploadFile,
  ): Promise<Analysis> {
    const buffer = assertXlsxUpload(file);
    const project = await this.loadProject(workspaceId, projectId);
    assertNotArchived(project.archivedAt);
    const catalog = await this.loadCatalog(workspaceId, project);
    const { rows } = await parseExcelBuffer(buffer);
    const validated = rows.map((r) => this.validateRow(r, catalog, projectId));
    return { catalog, total: rows.length, rows: validated };
  }

  /** Kiểm một dòng; hợp lệ thì dựng PreparedItem (kèm bước `after` trong cùng transaction của lô). */
  private validateRow(raw: RawExcelRow, c: ProjectCatalog, projectId: string): ValidatedRow {
    const errors: ExcelRowIssue[] = [];
    const warnings: ExcelRowIssue[] = [];
    const err = (key: ExcelColumnKey, message: string): void => {
      errors.push({ column: COL[key], message });
    };
    const text = (key: ExcelColumnKey): string => scalarText(raw.cells[key]);
    const byName = <T extends { name: string }>(xs: T[], v: string): T[] =>
      xs.filter((x) => norm(x.name) === norm(v));

    // Tiêu đề
    const summary = text('summary');
    if (!summary) err('summary', 'Bắt buộc nhập tiêu đề');
    else if (summary.length > 255)
      err('summary', `Tiêu đề dài ${summary.length} ký tự, tối đa 255 — hãy rút gọn`);

    const description = text('description');
    if (description.length > 50_000) err('description', 'Mô tả quá dài (tối đa 50.000 ký tự)');

    // Loại việc
    let type: ProjectCatalog['types'][number] | undefined;
    const typeText = text('type');
    if (!typeText) err('type', 'Bắt buộc chọn loại việc');
    else {
      type = byName(c.types, typeText)[0];
      if (!type)
        err('type', `'${typeText}' không phải loại việc của dự án — hãy chọn từ danh sách`);
      else if (type.isSubtask) {
        err(
          'type',
          `'${type.name}' cần việc cha nên không nhập được từ biểu mẫu — hãy chọn loại khác`,
        );
        type = undefined;
      }
    }

    // Ưu tiên
    let priorityId: string | undefined;
    const priorityText = text('priority');
    if (priorityText) {
      priorityId = byName(c.priorities, priorityText)[0]?.id;
      if (!priorityId)
        err('priority', `'${priorityText}' không phải mức ưu tiên hợp lệ — hãy chọn từ danh sách`);
    }

    // Trạng thái
    let statusId: string | undefined;
    const statusText = text('status');
    if (statusText) {
      statusId = byName(c.statuses, statusText)[0]?.id;
      if (!statusId)
        err('status', `'${statusText}' không có trong quy trình của dự án — hãy chọn từ danh sách`);
    }

    // Người
    const membersByEmail = new Map(c.members.map((m) => [norm(m.email), m.id]));
    const person = (key: 'assignee' | 'reporter'): string | undefined => {
      const t = text(key);
      if (!t) return undefined;
      const id = membersByEmail.get(personEmail(t));
      if (!id) err(key, `'${t}' không phải thành viên dự án`);
      return id;
    };
    const assigneeId = person('assignee');
    const reporterId = person('reporter');

    // Sprint
    let sprintId: string | undefined;
    const sprintText = text('sprint');
    if (sprintText) {
      const hits = byName(c.sprints, sprintText);
      if (hits.length === 0)
        err(
          'sprint',
          `'${sprintText}' không phải sprint đang chạy hoặc sắp tới của dự án — hãy chọn từ danh sách`,
        );
      else if (hits.length > 1)
        err(
          'sprint',
          `Có ${hits.length} sprint trùng tên '${sprintText}' — hãy đổi tên sprint rồi tải lại biểu mẫu`,
        );
      else sprintId = hits[0]!.id;
    }

    // Epic: "KEY — tiêu đề" hoặc chỉ mã epic
    let epicId: string | undefined;
    const epicText = text('epic');
    if (epicText) {
      const keyPart = epicText.split(/\s+[—–-]\s+/)[0]!.trim();
      const epic =
        c.epics.find((e) => norm(epicLabel(e)) === norm(epicText)) ??
        c.epics.find((e) => norm(e.key) === norm(keyPart));
      if (!epic) err('epic', `'${epicText}' không phải epic của dự án — hãy chọn từ danh sách`);
      else if (type && (type.key === 'EPIC' || type.hierarchyLevel >= 1))
        err('epic', 'Epic là cấp cao nhất — không thể đặt một Epic vào epic khác');
      else epicId = epic.id;
    }

    // Nhãn (nhiều, nhãn mới được tạo)
    const labelNames = splitMulti(text('labels'));
    const knownLabels = new Set(c.labels.map((l) => norm(l.name)));
    for (const name of labelNames) {
      if (name.length > 100) err('labels', `Nhãn '${name.slice(0, 20)}…' dài quá 100 ký tự`);
      else if (!knownLabels.has(norm(name)))
        warnings.push({ column: COL.labels, message: `Nhãn mới '${name}' sẽ được tạo` });
    }

    // Điểm
    let storyPoints: number | undefined;
    const pts = parseExcelNumber(raw.cells.points);
    if (pts === null) err('points', `'${text('points')}' không phải số`);
    else if (pts !== undefined) {
      if (pts < 0 || pts > 1000) err('points', `Điểm ${pts} ngoài khoảng 0–1000`);
      else storyPoints = pts;
    }

    // Ngày
    const dateOf = (key: 'startDate' | 'dueDate'): string | undefined => {
      const d = parseExcelDate(raw.cells[key]);
      if (d === null) err(key, `'${text(key)}' không phải ngày hợp lệ — hãy nhập dạng dd/mm/yyyy`);
      return d ?? undefined;
    };
    const startDate = dateOf('startDate');
    const dueDate = dateOf('dueDate');
    if (startDate && dueDate && dueDate < startDate)
      err('dueDate', 'Hạn hoàn thành phải sau hoặc bằng Ngày bắt đầu');

    // Thành phần (nhiều; phải có sẵn)
    const componentIds: string[] = [];
    for (const name of splitMulti(text('components'))) {
      const hit = byName(c.components, name)[0];
      if (!hit)
        err('components', `'${name}' không phải thành phần của dự án — hãy chọn từ danh sách`);
      else if (!componentIds.includes(hit.id)) componentIds.push(hit.id);
    }

    // Phiên bản (chưa phát hành)
    let versionId: string | undefined;
    const versionText = text('version');
    if (versionText) {
      versionId = byName(c.versions, versionText)[0]?.id;
      if (!versionId)
        err(
          'version',
          `'${versionText}' không phải phiên bản chưa phát hành của dự án — hãy chọn từ danh sách`,
        );
    }

    const view: ExcelPreviewRow = {
      row: raw.row,
      summary: summary.slice(0, 255),
      errors,
      warnings,
    };
    if (errors.length > 0 || !type) return { view };

    const item = this.buildItem(raw.row, projectId, {
      typeId: type.id,
      summary,
      description,
      priorityId,
      statusId,
      assigneeId,
      reporterId,
      sprintId,
      epicId,
      storyPoints,
      startDate,
      dueDate,
      labelNames,
      componentIds,
      versionId,
    });
    return { view, item };
  }

  /** Dựng PreparedItem; phần gắn nhãn/thành phần/phiên bản/người báo cáo chạy trong CÙNG transaction của lô. */
  private buildItem(row: number, projectId: string, f: RowFields): PreparedItem {
    const input: CreateIssueInput = {
      projectId,
      typeId: f.typeId,
      summary: f.summary,
      description: f.description || null,
      descriptionFormat: 'MARKDOWN',
      priorityId: f.priorityId,
      statusId: f.statusId,
      assigneeId: f.assigneeId,
      sprintId: f.sprintId,
      epicId: f.epicId,
      storyPoints: f.storyPoints,
      startDate: f.startDate,
      dueDate: f.dueDate,
    };
    return {
      row,
      input,
      reporterId: f.reporterId,
      after: async (tx, issue, labelCache) => {
        const labelIds = new Set<string>();
        for (const name of f.labelNames) {
          labelIds.add(await this.importer.resolveOrCreateLabel(tx, projectId, name, labelCache));
        }
        if (labelIds.size) {
          await tx.issueLabel.createMany({
            data: [...labelIds].map((labelId) => ({ issueId: issue.id, labelId })),
            skipDuplicates: true,
          });
        }
        if (f.componentIds.length) {
          await tx.issueComponent.createMany({
            data: f.componentIds.map((componentId) => ({ issueId: issue.id, componentId })),
            skipDuplicates: true,
          });
        }
        if (f.versionId) {
          await tx.issueFixVersion.createMany({
            data: [{ issueId: issue.id, versionId: f.versionId, type: 'FIX' }],
            skipDuplicates: true,
          });
        }
        return { labels: labelIds.size, comments: 0 };
      },
    };
  }
}
