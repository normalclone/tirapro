import { Injectable, Logger } from '@nestjs/common';
import type { KeyResultSource, Prisma } from '@prisma/client';
import {
  AppException,
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { TRIAGE_VISIBLE } from '../../common/triage-visibility';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { SearchService, VIEWER_JQL_MESSAGE } from '../search/search.service';
import { parseSourceConfig, type KeyResultSourceConfig } from './goals.schemas';

/** Phần của một Key Result mà bộ đo cần. */
export interface MeasurableKr {
  id: string;
  source: KeyResultSource;
  sourceConfig: Prisma.JsonValue | null;
}

/**
 * Phạm vi đo: `{ viewerId }` = theo dự án người xem thấy (đường đọc); `'public'` = ngữ cảnh hệ thống (cron chụp lịch
 * sử) — nguồn không chỉ định dự án chỉ tính trên dự án CÔNG KHAI để lịch sử không lộ số của dự án riêng tư.
 */
export type MeasureScope = { viewerId: string } | 'public';

export interface MeasureResult {
  /** Số đo được; `null` khi đo lỗi (nơi gọi giữ giá trị cũ để không nhảy về 0 gây hiểu nhầm). */
  value: number | null;
  measuredAt: string;
  /** Thông điệp lỗi hiển thị cho người dùng (JQL sai, dự án không còn…). */
  error: string | null;
}

/**
 * Đo Key Result tự đo (L25) từ dữ liệu dự án — tính LÚC ĐỌC, luôn theo dự án người xem thấy (dự án riêng tư
 * không lộ qua số của KR). KR nhập tay không có trong kết quả. KR cùng (nguồn, cấu hình) chỉ đo một lần;
 * mỗi phép đo tự bọc lỗi → `error` (không bao giờ ném).
 */
@Injectable()
export class KrMeasureService {
  private readonly logger = new Logger(KrMeasureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly search: SearchService,
  ) {}

  async measure(
    workspaceId: string,
    scope: MeasureScope,
    krs: MeasurableKr[],
  ): Promise<Map<string, MeasureResult>> {
    const auto = krs.filter((kr) => kr.source !== 'MANUAL');
    const out = new Map<string, MeasureResult>();
    if (auto.length === 0) return out;

    const groups = new Map<string, { kr: MeasurableKr; ids: string[] }>();
    for (const kr of auto) {
      const key = `${kr.source}|${JSON.stringify(kr.sourceConfig ?? {})}`;
      const g = groups.get(key);
      if (g) g.ids.push(kr.id);
      else groups.set(key, { kr, ids: [kr.id] });
    }

    const visible = await this.projectFilter(workspaceId, scope);
    const measuredAt = new Date().toISOString();
    await Promise.all(
      [...groups.values()].map(async ({ kr, ids }) => {
        let result: MeasureResult;
        try {
          const value = await this.measureOne(workspaceId, scope, visible, kr);
          result = { value, measuredAt, error: null };
        } catch (err) {
          result = { value: null, measuredAt, error: this.messageOf(err) };
        }
        for (const id of ids) out.set(id, result);
      }),
    );
    return out;
  }

  /**
   * Kiểm cấu hình lúc LƯU (đã chuẩn hoá bằng `parseSourceConfig`): dự án nêu trong cấu hình phải thuộc workspace và
   * người cấu hình thấy (404 'Dự án' như không tồn tại); JQL phải hợp lệ (cú pháp + giá trị) — sai → 422.
   */
  async validateConfig(
    workspaceId: string,
    viewerId: string,
    source: KeyResultSource,
    config: KeyResultSourceConfig,
  ): Promise<void> {
    if (source === 'ISSUE_COUNT_JQL') {
      const res = await this.search.validate(
        workspaceId,
        viewerId,
        (config as { jql: string }).jql,
      );
      if (!res.valid) throw new BusinessRuleException(res.error ?? 'JQL không hợp lệ');
      // Lịch sử chụp theo phạm vi công khai (không có người xem): JQL phụ thuộc currentUser/me sẽ cho số sai.
      if (this.search.dependsOnViewer((config as { jql: string }).jql))
        throw new BusinessRuleException(VIEWER_JQL_MESSAGE);
      return;
    }
    const projectId = (config as { projectId?: string } | null)?.projectId;
    if (!projectId) return;
    const visible = await this.access.visibleWhere(viewerId, workspaceId);
    const found = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null, ...visible },
      select: { id: true },
    });
    if (!found) throw new NotFoundAppException('Dự án');
  }

  /**
   * Điều kiện `project` thực sự áp cho một phép đo: phạm vi người xem → luôn `visible`; phạm vi công khai → chỉ
   * thu hẹp khi KHÔNG chỉ định dự án (KR chỉ định dự án đo đúng dự án đó; quyền XEM lịch sử xét lúc đọc).
   */
  private filterFor(
    scope: MeasureScope,
    visible: Prisma.ProjectWhereInput,
    hasProject: boolean,
  ): Prisma.ProjectWhereInput {
    return scope === 'public' && hasProject ? {} : visible;
  }

  /** Điều kiện `project` áp lên việc/dự án được đếm: theo người xem, hoặc `{ isPrivate: false }` cho phạm vi công khai. */
  private async projectFilter(
    workspaceId: string,
    scope: MeasureScope,
  ): Promise<Prisma.ProjectWhereInput> {
    return scope === 'public'
      ? { isPrivate: false }
      : this.access.visibleWhere(scope.viewerId, workspaceId);
  }

  private messageOf(err: unknown): string {
    if (err instanceof AppException) return err.message;
    this.logger.warn(`Đo Key Result lỗi: ${(err as Error)?.message ?? String(err)}`);
    return 'Không đo được số liệu lúc này';
  }

  private async measureOne(
    workspaceId: string,
    scope: MeasureScope,
    visible: Prisma.ProjectWhereInput,
    kr: MeasurableKr,
  ): Promise<number> {
    const cfg = parseSourceConfig(kr.source, kr.sourceConfig) ?? {};
    switch (kr.source) {
      case 'OPEN_BUGS': {
        const projectId = (cfg as { projectId?: string }).projectId;
        return this.prisma.issue.count({
          where: {
            workspaceId,
            deletedAt: null,
            type: { key: 'BUG' },
            status: { category: { not: 'DONE' } },
            project: { deletedAt: null, ...this.filterFor(scope, visible, !!projectId) },
            ...(projectId ? { projectId } : {}),
            ...TRIAGE_VISIBLE,
          },
        });
      }
      case 'SPRINT_COMPLETION':
        return this.sprintCompletion(
          workspaceId,
          this.filterFor(scope, visible, true),
          (cfg as { projectId: string }).projectId,
        );
      case 'ISSUE_COUNT_JQL': {
        const jql = (cfg as { jql: string }).jql;
        return scope === 'public'
          ? this.search.countPublic(workspaceId, jql)
          : this.search.count(workspaceId, scope.viewerId, jql);
      }
      default:
        throw new Error(`Nguồn số liệu không hỗ trợ: ${String(kr.source)}`);
    }
  }

  /** % điểm Done / điểm cam kết của sprint ACTIVE (không có → sprint đóng gần nhất); không điểm → 0. */
  private async sprintCompletion(
    workspaceId: string,
    visible: Prisma.ProjectWhereInput,
    projectId: string,
  ): Promise<number> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null, ...visible },
      select: { id: true },
    });
    // Dự án đã xoá hoặc riêng tư người xem không thấy: cùng một thông điệp như dự án không tồn tại (không lộ).
    if (!project) throw new NotFoundAppException('Dự án');

    const live = { projectId, deletedAt: null };
    const sprint =
      (await this.prisma.sprint.findFirst({
        where: { ...live, state: 'ACTIVE' },
        orderBy: { sequence: 'desc' },
        select: { id: true },
      })) ??
      (await this.prisma.sprint.findFirst({
        where: { ...live, state: 'CLOSED' },
        orderBy: [{ completeDate: 'desc' }, { sequence: 'desc' }],
        select: { id: true },
      }));
    if (!sprint) return 0;

    const inSprint = { sprintId: sprint.id, deletedAt: null, ...TRIAGE_VISIBLE };
    const [all, done] = await Promise.all([
      this.prisma.issue.aggregate({ where: inSprint, _sum: { storyPoints: true } }),
      this.prisma.issue.aggregate({
        where: { ...inSprint, status: { category: 'DONE' } },
        _sum: { storyPoints: true },
      }),
    ]);
    const committed = all._sum.storyPoints ?? 0;
    if (committed <= 0) return 0;
    return Math.round(((done._sum.storyPoints ?? 0) / committed) * 100);
  }
}
