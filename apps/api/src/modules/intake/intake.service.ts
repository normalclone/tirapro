import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { CreateIssueInput } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { IssuesService } from '../issues/issues.service';
import { CommentsService } from '../comments/comments.service';
import { SearchService } from '../search/search.service';
import { normalizeVi } from '../search/vi-text';
import type { ReportIssueInput, RequestKind } from './intake.schema';
import { buildReportNote } from './report-note';
import { assertNotArchived } from '../../common/project-writable';

/** So khớp tiêu đề giống hệt: bỏ dấu + hạ chữ + gộp khoảng trắng. */
function normalizeSummary(summary: string): string {
  return normalizeVi(summary).replace(/\s+/g, ' ').trim();
}

/** Gợi ý trùng cần tối thiểu 3 ký tự (sau trim) — ngắn hơn thì khớp gần như mọi thứ. */
const MIN_QUERY_LENGTH = 3;
const SUGGESTION_LIMIT = 5;
/** Số ứng viên lấy từ tìm kiếm trước khi cắt/so khớp (dư để bù bug đã xoá/ngoài dự án). */
const CANDIDATE_LIMIT = 8;

/** Loại yêu cầu → khoá IssueType (rơi về tên, rồi loại đầu tiên theo hierarchyLevel). */
const KIND_TYPE: Record<RequestKind, { key: 'BUG' | 'STORY' | 'TASK'; name: string }> = {
  BUG: { key: 'BUG', name: 'Bug' },
  FEATURE: { key: 'STORY', name: 'Story' },
  QUESTION: { key: 'TASK', name: 'Task' },
};

export interface ReportDedupedResult {
  deduped: true;
  issueId: string;
  key: string;
  occurrenceCount: number;
  commentId: string;
  /** `chosen` = người dùng chọn bug cũ; `auto` = tiêu đề giống hệt một bug còn sống. */
  merged: 'chosen' | 'auto';
}

export interface ReportCreatedResult {
  deduped: false;
  issueId: string;
  key: string;
}

export type ReportResult = ReportDedupedResult | ReportCreatedResult;

export interface DuplicateSuggestion {
  id: string;
  key: string;
  summary: string;
  occurrenceCount: number;
  triageState: string | null;
  status: { name: string; category: string };
  closed: boolean;
  resolution: string | null;
  severity: { id: string; name: string; color: string | null } | null;
  reporterName: string | null;
  createdAt: Date;
}

export interface ReportOptions {
  /**
   * Người báo có quyền `comment:create` ở dự án không (controller suy từ quyền hiệu lực). Mặc định `true`.
   * Không có: gộp có chọn bị từ chối (403); gộp tự động thì tạo bug mới để chữ của họ không bị mất.
   */
  canComment?: boolean;
}

interface MergeTarget {
  id: string;
  key: string;
  severityId?: string | null;
  triageState?: string | null;
}

/** Cửa sổ chống gửi đôi cho cùng một báo cáo (giây, cho Redis `EX`; bản bộ nhớ dùng mili giây tương ứng). */
const RECENT_REPORT_TTL_SEC = 8;
const RECENT_REPORT_TTL_MS = RECENT_REPORT_TTL_SEC * 1000;
/** Node khác đang chạy cùng báo cáo: hỏi lại Redis mỗi `POLL` ms, tối đa `WAIT` ms rồi báo bận. */
const SHARED_POLL_MS = 100;
const SHARED_WAIT_MS = 6_000;
const PENDING = 'pending';

/** JSON ổn định (khoá sắp xếp) để cùng một môi trường luôn ra cùng một chuỗi dù thứ tự khoá khác nhau. */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? '';
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

/**
 * Dấu vân tay của một báo cáo: người + dự án + đích gộp + tiêu đề chuẩn hoá + loại yêu cầu + loại công việc +
 * mức nghiêm trọng + môi trường + mô tả + tệp. Hai báo cáo khác bất kỳ mục nào là việc KHÁC nhau, không phải gửi đôi.
 */
function reportFingerprint(userId: string, input: ReportIssueInput): string {
  const body = createHash('sha1')
    .update(input.description ?? '')
    .digest('hex');
  return [
    userId,
    input.projectId,
    input.mergeIntoIssueId ?? '',
    input.forceNew ? 'new' : '',
    input.kind,
    input.typeId ?? '',
    input.severityId ?? '',
    stableJson(input.environment ?? null),
    normalizeSummary(input.summary),
    body,
    [...(input.attachmentIds ?? [])].sort().join(','),
  ].join('|');
}

/** Phần tối thiểu của ioredis mà khoá chống gửi đôi cần. */
interface DedupeClient {
  set(key: string, value: string, mode: 'EX', ttlSec: number, flag: 'NX'): Promise<'OK' | null>;
  set(key: string, value: string, mode: 'EX', ttlSec: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);
  private readonly recent = new Map<string, { at: number; promise: Promise<ReportResult> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
    private readonly comments: CommentsService,
    private readonly search: SearchService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Báo cáo một bug / gửi yêu cầu. Ba nhánh, nội dung của người báo KHÔNG BAO GIỜ bị bỏ:
   * (1) `mergeIntoIssueId` — thêm ghi chú vào bug đã chọn; (2) tiêu đề giống hệt một bug còn sống mà client
   * không nói gì — gộp tự động, vẫn lưu nội dung thành bình luận; (3) tạo bug mới (`forceNew` bỏ qua 1-2).
   * Người báo luôn thành watcher.
   */
  async report(
    workspaceId: string,
    userId: string,
    input: ReportIssueInput,
    opts: ReportOptions = {},
  ): Promise<ReportResult> {
    // Chống gửi đôi (bấm đúp, thử lại sau lỗi mạng): cùng người + cùng nội dung trong vài giây dùng chung MỘT kết quả
    // (kể cả khi lần đầu còn đang chạy) — không tạo bug / bình luận thứ hai. Lớp bộ nhớ (cùng tiến trình) luôn có;
    // Redis thêm lớp xuyên tiến trình khi chạy nhiều node. Lỗi thì bỏ khỏi bộ nhớ/Redis để thử lại được.
    const dedupeKey = reportFingerprint(userId, input);
    const now = Date.now();
    for (const [k, v] of this.recent) if (now - v.at > RECENT_REPORT_TTL_MS) this.recent.delete(k);
    const hit = this.recent.get(dedupeKey);
    if (hit) return hit.promise;
    const promise = this.reportOnce(dedupeKey, workspaceId, userId, input, opts);
    this.recent.set(dedupeKey, { at: now, promise });
    promise.catch(() => this.recent.delete(dedupeKey));
    return promise;
  }

  /**
   * Lớp Redis của chống gửi đôi: `SET key pending NX EX 8` — ai lấy được khoá thì chạy rồi ghi kết quả vào khoá
   * (node khác trong 8 giây nhận lại đúng kết quả đó); không lấy được thì chờ kết quả. Redis không sẵn sàng/lỗi
   * ở bất kỳ bước nào thì rơi về chạy thẳng (khoá bộ nhớ ở `report()` vẫn che gửi đôi cùng tiến trình).
   */
  private async reportOnce(
    dedupeKey: string,
    workspaceId: string,
    userId: string,
    input: ReportIssueInput,
    opts: ReportOptions,
  ): Promise<ReportResult> {
    const client = (
      this.redis?.isAvailable() ? this.redis.getClient() : null
    ) as DedupeClient | null;
    if (!client) return this.doReport(workspaceId, userId, input, opts);

    const key = `intake:report:${createHash('sha1').update(dedupeKey).digest('hex')}`;
    let acquired: boolean;
    try {
      acquired = (await client.set(key, PENDING, 'EX', RECENT_REPORT_TTL_SEC, 'NX')) === 'OK';
    } catch (err) {
      this.logger.warn(`Redis lỗi khi lấy khoá chống gửi đôi — dùng khoá bộ nhớ: ${errMsg(err)}`);
      return this.doReport(workspaceId, userId, input, opts);
    }

    if (!acquired) {
      const shared = await this.waitForSharedResult(client, key);
      if (shared) return shared;
      // Khoá đã biến mất (lần đầu lỗi hoặc hết hạn) hoặc Redis lỗi giữa chừng: tự chạy, không để mất báo cáo.
      return this.doReport(workspaceId, userId, input, opts);
    }

    try {
      const result = await this.doReport(workspaceId, userId, input, opts);
      await client
        .set(key, JSON.stringify(result), 'EX', RECENT_REPORT_TTL_SEC)
        .catch(async (e: unknown) => {
          this.logger.warn(`Không ghi được kết quả chống gửi đôi: ${errMsg(e)}`);
          // Gỡ khoá `pending` để node khác không phải chờ hết hạn rồi báo "đang xử lý" cho một báo cáo đã thành công.
          await client.del(key).catch(() => undefined);
        });
      return result;
    } catch (err) {
      await client.del(key).catch(() => undefined);
      throw err;
    }
  }

  /** Chờ node khác ghi xong kết quả; null = khoá biến mất/Redis lỗi (để người gọi tự chạy). Chờ quá lâu thì báo bận. */
  private async waitForSharedResult(
    client: DedupeClient,
    key: string,
  ): Promise<ReportResult | null> {
    const deadline = Date.now() + SHARED_WAIT_MS;
    try {
      for (;;) {
        const v = await client.get(key);
        if (v === null) return null;
        if (v !== PENDING) return JSON.parse(v) as ReportResult;
        if (Date.now() >= deadline) break;
        await sleep(SHARED_POLL_MS);
      }
    } catch (err) {
      this.logger.warn(`Redis lỗi khi chờ kết quả chống gửi đôi: ${errMsg(err)}`);
      return null;
    }
    throw new BusinessRuleException(
      'Báo cáo giống hệt đang được xử lý — hãy chờ vài giây rồi kiểm tra danh sách trước khi gửi lại',
    );
  }

  private async doReport(
    workspaceId: string,
    userId: string,
    input: ReportIssueInput,
    opts: ReportOptions,
  ): Promise<ReportResult> {
    const canComment = opts.canComment ?? true;
    // 1. Xác minh project thuộc workspace hiện tại, chưa lưu trữ (cả nhánh gộp lẫn tạo mới).
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, workspaceId, deletedAt: null },
      select: { id: true, archivedAt: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    assertNotArchived(project.archivedAt);

    if (input.mergeIntoIssueId) {
      if (!canComment) throw new ForbiddenAppException('Bạn không có quyền bình luận ở dự án này');
      const target = await this.prisma.issue.findFirst({
        where: { id: input.mergeIntoIssueId, projectId: input.projectId, deletedAt: null },
        select: { id: true, key: true, severityId: true, triageState: true },
      });
      if (!target) throw new NotFoundAppException('Công việc cần gộp');
      return this.appendReport(workspaceId, userId, target, input, 'chosen');
    }

    // Gộp tự động chỉ cho Bug (client cũ mặc định BUG): yêu cầu tính năng/câu hỏi trùng tiêu đề một Bug vẫn là việc riêng.
    if (!input.forceNew && canComment && input.kind === 'BUG') {
      const hit = await this.findLiveExactTitle(workspaceId, input.projectId, input.summary);
      if (hit) return this.appendReport(workspaceId, userId, hit, input, 'auto');
    }
    return this.createNew(workspaceId, userId, input);
  }

  /**
   * Gợi ý các bug có thể trùng cho UI (tối đa 5): tìm kiếm bỏ dấu/tiền tố/trigram có xếp hạng (không đọc cả dự án),
   * kể cả bug đã đóng (đánh `closed`) vì "bug cũ tái diễn" là ca phổ biến.
   */
  async findDuplicates(
    workspaceId: string,
    projectId: string,
    summary: string,
    viewerId: string,
    limit = SUGGESTION_LIMIT,
  ): Promise<DuplicateSuggestion[]> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
    // Dự án riêng tư người báo không thấy → 404 như dự án không tồn tại (kể cả khi tiêu đề quá ngắn để tìm).
    await this.search.assertProjectVisibleTo(viewerId, workspaceId, projectId);

    const query = summary.trim();
    if ([...query].length < MIN_QUERY_LENGTH) return [];
    const take = Math.min(Math.max(Math.trunc(limit) || SUGGESTION_LIMIT, 1), SUGGESTION_LIMIT);

    const ids = await this.search.similarIssueIds(
      workspaceId,
      projectId,
      query,
      viewerId,
      CANDIDATE_LIMIT,
    );
    if (ids.length === 0) return [];

    const rows = await this.prisma.issue.findMany({
      where: { id: { in: ids }, projectId, deletedAt: null },
      select: {
        id: true,
        key: true,
        summary: true,
        occurrenceCount: true,
        triageState: true,
        createdAt: true,
        status: { select: { name: true, category: true } },
        resolution: { select: { name: true } },
        severity: { select: { id: true, name: true, color: true } },
        reporter: { select: { displayName: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .slice(0, take)
      .map((r) => ({
        id: r.id,
        key: r.key,
        summary: r.summary,
        occurrenceCount: r.occurrenceCount,
        triageState: r.triageState,
        status: { name: r.status.name, category: r.status.category },
        closed: r.status.category === 'DONE',
        resolution: r.resolution?.name ?? null,
        severity: r.severity,
        reporterName: r.reporter?.displayName ?? null,
        createdAt: r.createdAt,
      }));
  }

  /**
   * Bug "sống" có tiêu đề giống hệt (chuẩn hoá bỏ dấu); ứng viên lấy từ tìm kiếm, không đọc cả dự án.
   * Dò trùng ngầm chỉ là phụ: lỗi (timeout, DB tạm…) thì ghi log và coi như không trùng để báo lỗi vẫn được ghi.
   */
  private async findLiveExactTitle(
    workspaceId: string,
    projectId: string,
    summary: string,
  ): Promise<MergeTarget | null> {
    try {
      // Đã qua guard dự án của POST /intake/report → ngữ cảnh hệ thống (null), không kiểm lại quyền xem.
      const ids = await this.search.similarIssueIds(workspaceId, projectId, summary, null, 10);
      if (ids.length === 0) return null;
      const candidates = await this.prisma.issue.findMany({
        where: { id: { in: ids }, projectId, deletedAt: null },
        select: {
          id: true,
          key: true,
          summary: true,
          severityId: true,
          triageState: true,
          status: { select: { category: true } },
        },
      });
      const target = normalizeSummary(summary);
      return (
        candidates.find((c) => {
          if (normalizeSummary(c.summary) !== target) return false;
          // "Sống" = đang chờ/snooze triage HOẶC trạng thái chưa Done.
          const liveTriage = c.triageState === 'PENDING' || c.triageState === 'SNOOZED';
          return liveTriage || c.status.category !== 'DONE';
        }) ?? null
      );
    } catch (err) {
      this.logger.warn(
        `Dò trùng tiêu đề thất bại — bỏ qua và tạo mới: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Gộp vào bug có sẵn: tăng số lần + watcher trong một giao dịch, rồi (sau commit) lưu nội dung thành bình luận. */
  private async appendReport(
    workspaceId: string,
    userId: string,
    target: MergeTarget,
    input: ReportIssueInput,
    merged: 'chosen' | 'auto',
  ): Promise<ReportDedupedResult> {
    const ids = [...new Set(input.attachmentIds ?? [])];
    // Chỉ nhận tệp thuộc ĐÚNG bug đích và do chính người dùng tải; id lạ bị bỏ (không lỗi toàn bộ).
    const attachments = ids.length
      ? await this.prisma.attachment.findMany({
          where: { id: { in: ids }, issueId: target.id, uploadedById: userId },
          select: { id: true, fileName: true, mimeType: true },
        })
      : [];

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.issue.update({
        where: { id: target.id },
        data: {
          occurrenceCount: { increment: 1 },
          // Chỉ việc đã bị Từ chối mới quay lại hàng chờ. Việc đã Nhận / đang làm / đã đóng GIỮ NGUYÊN trạng thái duyệt
          // (không biến khỏi Board/Việc chờ): PM thấy báo lại qua đếm, bình luận và thông báo cho người theo dõi.
          ...(target.triageState === 'DECLINED' ? { triageState: 'PENDING' as const } : {}),
          lastOccurredAt: new Date(),
          version: { increment: 1 },
        },
        select: { id: true, key: true, occurrenceCount: true },
      });
      await tx.issueWatcher.createMany({
        data: [{ issueId: target.id, userId }],
        skipDuplicates: true,
      });
      return row;
    });

    const [user, severity] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
      input.severityId && input.severityId !== target.severityId
        ? this.prisma.severity.findFirst({
            where: { id: input.severityId, workspaceId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    const body = buildReportNote({
      reporterName: user?.displayName ?? 'Một người dùng',
      at: new Date(),
      description: input.description,
      environment: input.environment ?? null,
      severityName: severity?.name ?? null,
      attachments,
    });
    const comment = await this.comments.create(workspaceId, userId, target.id, {
      body,
      bodyFormat: 'MARKDOWN',
    });
    return {
      deduped: true,
      issueId: updated.id,
      key: updated.key,
      occurrenceCount: updated.occurrenceCount,
      commentId: comment.id,
      merged,
    };
  }

  private async createNew(
    workspaceId: string,
    userId: string,
    input: ReportIssueInput,
  ): Promise<ReportCreatedResult> {
    const typeId = input.typeId ?? (await this.resolveTypeId(workspaceId, input.kind));
    const createInput: CreateIssueInput = {
      projectId: input.projectId,
      typeId,
      summary: input.summary,
      description: input.description ?? null,
      descriptionFormat: 'MARKDOWN',
      ...(input.severityId ? { severityId: input.severityId } : {}),
      ...(input.environment ? { environment: input.environment } : {}),
    };
    const created = await this.issues.create(workspaceId, userId, createInput);

    // Không tăng `version` (giữ như cũ) để client chưa kịp đồng bộ không bị 409.
    await this.prisma.issue.update({
      where: { id: created.id },
      data: {
        triageState: 'PENDING',
        triageSource: input.kind,
        occurrenceCount: 1,
        lastOccurredAt: new Date(),
      },
    });
    // Người báo nhận cập nhật triage (nền tảng cho thông báo "từ chối có lý do" ở Q10).
    await this.prisma.issueWatcher.createMany({
      data: [{ issueId: created.id, userId }],
      skipDuplicates: true,
    });

    return { deduped: false, issueId: created.id, key: created.key };
  }

  /** typeId theo loại yêu cầu: key → tên → loại đầu tiên theo hierarchyLevel. */
  private async resolveTypeId(workspaceId: string, kind: RequestKind): Promise<string> {
    const want = KIND_TYPE[kind];
    const byKey = await this.prisma.issueType.findFirst({
      where: { workspaceId, key: want.key },
      select: { id: true },
    });
    if (byKey) return byKey.id;
    const byName = await this.prisma.issueType.findFirst({
      where: { workspaceId, name: want.name },
      select: { id: true },
    });
    if (byName) return byName.id;

    const first = await this.prisma.issueType.findFirst({
      where: { workspaceId },
      orderBy: { hierarchyLevel: 'asc' },
      select: { id: true },
    });
    if (!first)
      throw new BusinessRuleException(
        'Không gian làm việc chưa có loại công việc nào — hãy vào Cấu hình để thêm ít nhất một loại công việc',
      );
    return first.id;
  }
}
