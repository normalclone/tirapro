import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { extractIssueKeys } from '@tirapro/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { insensitiveContains } from '../../common/like';
import {
  BusinessRuleException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { assertNotArchived, assertProjectIdWritable } from '../../common/project-writable';
import type {
  CreateWikiPageInput,
  MoveWikiPageInput,
  RestoreWikiVersionInput,
  UpdateWikiPageInput,
} from './wiki.schemas';

/** Số mã công việc tối đa ghi liên kết cho một trang. */
const MAX_LINKED_ISSUES = 500;

/** Số phiên bản lịch sử giữ lại cho mỗi trang (xoá bản cũ nhất khi vượt). */
const MAX_VERSIONS = 200;

/** Giá trị `projectId` đặc biệt trên query: chỉ lấy tài liệu chung của workspace. */
const SCOPE_WORKSPACE = 'none';

const NODE_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  parentId: true,
  title: true,
  order: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

type NodeRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  order: number;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Người đang thao tác/đọc (để lọc theo quyền xem dự án). */
export interface WikiActor {
  id: string;
  isSystemAdmin?: boolean;
}

export interface WikiNodeDto {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  order: number;
  updatedAt: string;
  children: WikiNodeDto[];
}

/** Công việc được nhắc trong trang wiki (để vẽ chip). */
export interface WikiIssueRefDto {
  id: string;
  key: string;
  summary: string;
  typeName: string;
  statusName: string;
  statusCategory: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

export interface WikiByIssueDto {
  id: string;
  title: string;
  projectId: string | null;
  projectKey: string | null;
  updatedAt: string;
}

/** Một dòng trong lịch sử trang (không kèm nội dung). */
export interface WikiVersionSummaryDto {
  version: number;
  title: string;
  authorName: string | null;
  note: string | null;
  createdAt: string;
  /** Độ dài nội dung (ký tự). */
  size: number;
}

export interface WikiVersionDto extends WikiVersionSummaryDto {
  body: string;
}

export interface WikiPageDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  body: string;
  order: number;
  /** Số phiên bản nội dung (OCC): gửi lại ở `expectedVersion` khi lưu. Đổi chỗ/đổi cha không tăng. */
  version: number;
  createdBy: { id: string; displayName: string } | null;
  updatedBy: { id: string; displayName: string } | null;
  /** Đường dẫn từ gốc tới trang (không gồm chính nó) — dùng cho breadcrumb. */
  breadcrumb: { id: string; title: string }[];
  /** Công việc còn sống được nhắc trong nội dung trang (suy ra từ mã công việc). */
  issues: WikiIssueRefDto[];
  createdAt: string;
  updatedAt: string;
}

export interface WikiSearchHit {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  /** Đoạn trích quanh từ khoá trong nội dung (rỗng nếu chỉ khớp tiêu đề). */
  snippet: string;
  updatedAt: string;
}

/**
 * Wiki / tài liệu nội bộ — trang markdown phân cấp (cây tự tham chiếu).
 * Phạm vi: `projectId = null` là tài liệu chung workspace, ngược lại thuộc một dự án.
 * Đọc = workspace:view, ghi = wiki:manage theo dự án của trang (trang chung: quyền workspace),
 * xoá = project:admin (guard ở controller).
 */
@Injectable()
export class WikiService {
  private readonly logger = new Logger(WikiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  /** Cây trang theo phạm vi. `projectId` bỏ trống = mọi trang trong workspace. */
  async tree(workspaceId: string, projectId?: string): Promise<WikiNodeDto[]> {
    const rows = await this.prisma.wikiPage.findMany({
      where: { workspaceId, ...this.scopeWhere(projectId) },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
      select: NODE_SELECT,
    });
    return this.buildTree(rows);
  }

  /** Tìm theo tiêu đề hoặc nội dung (không phân biệt hoa/thường). Trả danh sách phẳng. */
  async search(workspaceId: string, q: string, projectId?: string): Promise<WikiSearchHit[]> {
    const term = q.trim();
    if (!term) return [];
    const rows = await this.prisma.wikiPage.findMany({
      where: {
        workspaceId,
        ...this.scopeWhere(projectId),
        OR: [{ title: insensitiveContains(term) }, { body: insensitiveContains(term) }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { ...NODE_SELECT, body: true },
    });
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      parentId: r.parentId,
      title: r.title,
      snippet: this.snippet(r.body, term),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /**
   * Những người có thể cấp quyền viết wiki / xoá trang ở phạm vi này: ai đang có `project:admin`
   * (qua vai workspace, hoặc vai dự án nếu có `projectId`). Dùng cho câu "Nhờ … cấp quyền" của FE.
   * Tối đa 8 người, bỏ tài khoản đã vô hiệu hoá. `projectId` bỏ trống/`none` → chỉ quản trị workspace.
   */
  async admins(
    workspaceId: string,
    projectId?: string,
  ): Promise<{ id: string; displayName: string }[]> {
    const has = { permissions: { some: { permission: { key: PERMISSIONS.PROJECT_ADMIN } } } };
    const active = { status: { not: 'DEACTIVATED' as const } };
    const holder = { OR: [{ role: has }, { roles: { some: { role: has } } }] };
    const select = { user: { select: { id: true, displayName: true } } } as const;
    const ws = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, user: active, ...holder },
      select,
      orderBy: { user: { displayName: 'asc' } },
      take: 8,
    });
    const proj =
      projectId && projectId !== SCOPE_WORKSPACE
        ? await this.prisma.projectMembership.findMany({
            where: { projectId, user: active, ...holder },
            select,
            orderBy: { user: { displayName: 'asc' } },
            take: 8,
          })
        : [];
    const byId = new Map([...ws, ...proj].map((m) => [m.user.id, m.user]));
    return [...byId.values()]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'))
      .slice(0, 8);
  }

  async get(workspaceId: string, id: string, viewer: WikiActor): Promise<WikiPageDto> {
    const page = await this.prisma.wikiPage.findFirst({ where: { id, workspaceId } });
    if (!page) throw new NotFoundAppException('Trang tài liệu');

    const breadcrumb = await this.ancestors(workspaceId, page.parentId);
    const userIds = [page.createdById, page.updatedById].filter((v): v is string => !!v);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: [...new Set(userIds)] } },
          select: { id: true, displayName: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const links = await this.prisma.wikiPageIssue.findMany({
      where: { wikiPageId: id, issue: await this.visibleIssueFilter(viewer, workspaceId) },
      select: {
        issue: {
          select: {
            id: true,
            key: true,
            summary: true,
            type: { select: { name: true } },
            status: { select: { name: true, category: true } },
          },
        },
      },
    });

    return {
      id: page.id,
      workspaceId: page.workspaceId,
      projectId: page.projectId,
      parentId: page.parentId,
      title: page.title,
      body: page.body,
      order: page.order,
      version: page.version,
      createdBy: (page.createdById && byId.get(page.createdById)) || null,
      updatedBy: (page.updatedById && byId.get(page.updatedById)) || null,
      breadcrumb,
      issues: links.map(({ issue: i }) => ({
        id: i.id,
        key: i.key,
        summary: i.summary,
        typeName: i.type.name,
        statusName: i.status.name,
        statusCategory: i.status.category,
      })),
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /** Các trang wiki nhắc tới một công việc (cho khối "Tài liệu liên quan"). */
  async byIssue(
    workspaceId: string,
    issueId: string,
    viewer: WikiActor,
  ): Promise<WikiByIssueDto[]> {
    // Trang chung (không dự án) luôn thấy; trang của dự án chỉ khi người gọi xem được dự án đó.
    const { project } = await this.visibleIssueFilter(viewer, workspaceId);
    const rows = await this.prisma.wikiPage.findMany({
      where: {
        workspaceId,
        issues: { some: { issueId } },
        OR: [{ projectId: null }, { project }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        projectId: true,
        updatedAt: true,
        project: { select: { key: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectKey: r.project?.key ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async create(
    workspaceId: string,
    dto: CreateWikiPageInput,
    actor: WikiActor,
  ): Promise<WikiPageDto> {
    const title = dto.title.trim();
    if (!title) throw new BusinessRuleException('Tiêu đề bắt buộc');

    const projectId = dto.projectId ?? null;
    const parentId = dto.parentId ?? null;
    if (parentId) {
      const parent = await this.requireWritablePage(workspaceId, parentId);
      // Trang con luôn cùng phạm vi với trang cha; client gửi phạm vi khác → từ chối
      // (guard tính quyền theo body.projectId, không để nó lái ghi sang dự án khác).
      if (projectId !== parent.projectId) {
        throw new BusinessRuleException('Trang con phải cùng phạm vi (dự án) với trang cha');
      }
    } else if (projectId) {
      await this.requireProject(workspaceId, projectId);
    }

    const body = dto.body ?? '';
    const order = await this.nextOrder(workspaceId, projectId, parentId);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.wikiPage.create({
        data: {
          workspaceId,
          projectId,
          parentId,
          title,
          body,
          order,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true },
      });
      await this.snapshot(tx, row.id, title, body, actor.id);
      return row;
    });
    if (dto.body) await this.syncIssueLinks(workspaceId, created.id, dto.body);
    return this.get(workspaceId, created.id, actor);
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateWikiPageInput,
    actor: WikiActor,
  ): Promise<WikiPageDto> {
    const current = await this.requireWritablePage(workspaceId, id);
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) throw new BusinessRuleException('Tiêu đề bắt buộc');
    await this.writePage(
      workspaceId,
      id,
      current.title,
      { title, body: dto.body },
      dto.expectedVersion,
      actor.id,
    );
    if (dto.body !== undefined) await this.syncIssueLinks(workspaceId, id, dto.body);
    return this.get(workspaceId, id, actor);
  }

  /** Lịch sử trang: mới nhất trước, tối đa 200 bản, không kèm nội dung. */
  async listVersions(workspaceId: string, id: string): Promise<WikiVersionSummaryDto[]> {
    await this.requirePage(workspaceId, id);
    const rows = await this.prisma.wikiPageVersion.findMany({
      where: { wikiPageId: id },
      orderBy: { version: 'desc' },
      take: MAX_VERSIONS,
    });
    const names = await this.authorNames(rows.map((r) => r.authorId));
    return rows.map((r) => this.toVersionSummary(r, names));
  }

  /** Nội dung một phiên bản của trang. */
  async getVersion(workspaceId: string, id: string, version: number): Promise<WikiVersionDto> {
    await this.requirePage(workspaceId, id);
    const row = await this.prisma.wikiPageVersion.findFirst({
      where: { wikiPageId: id, version },
    });
    if (!row) throw new NotFoundAppException('Phiên bản trang tài liệu');
    const names = await this.authorNames([row.authorId]);
    return { ...this.toVersionSummary(row, names), body: row.body };
  }

  /**
   * Khôi phục một phiên bản cũ: ghi tiêu đề/nội dung của bản đó lên trang rồi tạo phiên bản MỚI
   * (`note` = "Khôi phục từ phiên bản N") — lịch sử không bao giờ bị cắt. Đi cùng đường ghi của `update`
   * (chặn dự án lưu trữ, OCC theo `expectedVersion` — bắt buộc vì người bấm đang xem một trạng thái cụ thể).
   */
  async restoreVersion(
    workspaceId: string,
    id: string,
    version: number,
    dto: RestoreWikiVersionInput,
    actor: WikiActor,
  ): Promise<WikiPageDto> {
    const current = await this.requireWritablePage(workspaceId, id);
    const target = await this.prisma.wikiPageVersion.findFirst({
      where: { wikiPageId: id, version },
      select: { version: true, title: true, body: true },
    });
    if (!target) throw new NotFoundAppException('Phiên bản trang tài liệu');
    await this.writePage(
      workspaceId,
      id,
      current.title,
      { title: target.title, body: target.body },
      dto.expectedVersion,
      actor.id,
      `Khôi phục từ phiên bản ${target.version}`,
    );
    await this.syncIssueLinks(workspaceId, id, target.body);
    return this.get(workspaceId, id, actor);
  }

  /**
   * Đổi trang cha và/hoặc vị trí trong danh sách anh em.
   * Chặn chu trình (không cho chuyển vào chính nó hoặc con cháu của nó);
   * đánh lại `order` liên tục 0..n cho nhóm anh em cũ và mới.
   */
  async move(workspaceId: string, id: string, dto: MoveWikiPageInput): Promise<WikiNodeDto[]> {
    const page = await this.requireWritablePage(workspaceId, id);
    const nextParentId = dto.parentId === undefined ? page.parentId : dto.parentId;

    if (nextParentId === id) throw new BusinessRuleException('Không thể chuyển trang vào chính nó');
    if (nextParentId) {
      const parent = await this.requirePage(workspaceId, nextParentId);
      if (parent.projectId !== page.projectId) {
        throw new BusinessRuleException(
          'Chỉ chuyển được trong cùng phạm vi — trang chung của không gian làm việc, hoặc trong cùng một dự án',
        );
      }
      if (await this.isDescendant(workspaceId, nextParentId, id)) {
        throw new BusinessRuleException('Không thể chuyển trang vào trang con của chính nó');
      }
    }

    const siblings = await this.prisma.wikiPage.findMany({
      where: {
        workspaceId,
        projectId: page.projectId,
        parentId: nextParentId,
        NOT: { id },
      },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
      select: { id: true, order: true, updatedAt: true },
    });
    const target = Math.min(Math.max(dto.order ?? siblings.length, 0), siblings.length);
    const ordered = [
      ...siblings.slice(0, target),
      { id, order: page.order, updatedAt: page.updatedAt },
      ...siblings.slice(target),
    ];

    // Chỉ ghi hàng có vị trí/cha THỰC SỰ đổi; giữ nguyên `updatedAt` và không đụng `version`/`updatedById`
    // (đổi chỗ không phải sửa nội dung → không làm người đang sửa trang anh em bị 409 giả).
    const writes = ordered.flatMap((row, idx) => {
      const isMoved = row.id === id;
      const changed = isMoved
        ? nextParentId !== page.parentId || row.order !== idx
        : row.order !== idx;
      if (!changed) return [];
      return [
        this.prisma.wikiPage.update({
          where: { id: row.id },
          data: {
            order: idx,
            updatedAt: row.updatedAt,
            ...(isMoved ? { parentId: nextParentId } : {}),
          },
        }),
      ];
    });
    if (writes.length) await this.prisma.$transaction(writes);

    // Nhóm anh em cũ có thể thủng số thứ tự → đánh lại cho gọn.
    if (page.parentId !== nextParentId)
      await this.renumber(workspaceId, page.projectId, page.parentId);

    return this.tree(workspaceId, page.projectId ?? SCOPE_WORKSPACE);
  }

  /** Xoá trang; các trang con được nâng lên làm con của trang cha (không mất dữ liệu). */
  async remove(workspaceId: string, id: string): Promise<{ success: true }> {
    const page = await this.requireWritablePage(workspaceId, id);
    await this.prisma.$transaction([
      this.prisma.wikiPage.updateMany({
        where: { parentId: id },
        data: { parentId: page.parentId },
      }),
      this.prisma.wikiPage.delete({ where: { id } }),
    ]);
    await this.renumber(workspaceId, page.projectId, page.parentId);
    return { success: true };
  }

  // ───────────────────────── helpers ─────────────────────────

  /**
   * Lõi ghi nội dung trang (dùng chung cho `update` và `restoreVersion`): ghi + chụp phiên bản trong MỘT giao dịch.
   * Có `expectedVersion` → kiểm-và-ghi trong một câu lệnh (lệch version → không dòng nào khớp → 409; trang đã
   * bị xoá → 404). Câu UPDATE khoá dòng trang nên hai lần lưu đồng thời được tuần tự hoá (không đua số phiên bản).
   */
  private async writePage(
    workspaceId: string,
    id: string,
    currentTitle: string,
    patch: { title?: string; body?: string },
    expectedVersion: number | undefined,
    userId: string,
    note?: string,
  ): Promise<void> {
    const data = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      updatedById: userId,
      version: { increment: 1 },
    };
    await this.prisma.$transaction(async (tx) => {
      let title = patch.title ?? currentTitle;
      let body = patch.body;
      if (expectedVersion !== undefined) {
        const r = await tx.wikiPage.updateMany({
          where: { id, workspaceId, version: expectedVersion },
          data,
        });
        if (r.count === 0) {
          // Phân biệt "trang vừa bị xoá" (404) với "người khác vừa lưu" (409).
          const still = await tx.wikiPage.findFirst({
            where: { id, workspaceId },
            select: { id: true },
          });
          if (!still) throw new NotFoundAppException('Trang tài liệu');
          throw new VersionConflictException(
            'Trang vừa được người khác sửa — hãy xem bản mới, sao chép phần bạn vừa viết hoặc ghi đè có xác nhận.',
          );
        }
        // Chỉ sửa tiêu đề: nội dung giữ nguyên nên lấy lại từ dòng vừa ghi để chụp phiên bản đủ bộ.
        if (body === undefined) {
          const row = await tx.wikiPage.findFirst({ where: { id }, select: { body: true } });
          body = row?.body ?? '';
        }
      } else {
        // Không OCC: lấy tiêu đề/nội dung cuối cùng từ chính dòng vừa ghi (không dựa bản đọc trước đó, có thể cũ).
        const row = await tx.wikiPage.update({
          where: { id },
          data,
          select: { title: true, body: true },
        });
        title = row?.title ?? title;
        body = row?.body ?? body;
      }
      await this.snapshot(tx, id, title, body ?? '', userId, note ?? null);
    });
  }

  /**
   * Chụp phiên bản mới của trang (nguyên bản). Bỏ qua khi tiêu đề và nội dung không đổi so với bản mới nhất
   * (trừ khi có `note`, vd khôi phục). Giữ tối đa MAX_VERSIONS bản: xoá bản cũ nhất khi vượt.
   */
  private async snapshot(
    tx: Prisma.TransactionClient,
    pageId: string,
    title: string,
    body: string,
    userId: string,
    note: string | null = null,
  ): Promise<void> {
    const last = await tx.wikiPageVersion.findFirst({
      where: { wikiPageId: pageId },
      orderBy: { version: 'desc' },
      select: { version: true, title: true, body: true },
    });
    if (last && last.title === title && last.body === body && !note) return;
    const version = (last?.version ?? 0) + 1;
    await tx.wikiPageVersion.create({
      data: { wikiPageId: pageId, version, title, body, authorId: userId, note },
    });
    if (version > MAX_VERSIONS) {
      await tx.wikiPageVersion.deleteMany({
        where: { wikiPageId: pageId, version: { lte: version - MAX_VERSIONS } },
      });
    }
  }

  private async authorNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  private toVersionSummary(
    r: {
      version: number;
      title: string;
      body: string;
      authorId: string | null;
      note: string | null;
      createdAt: Date;
    },
    names: Map<string, string>,
  ): WikiVersionSummaryDto {
    return {
      version: r.version,
      title: r.title,
      authorName: (r.authorId && names.get(r.authorId)) || null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      size: r.body.length,
    };
  }

  /**
   * Điều kiện Prisma cho công việc mà `viewer` được thấy: còn sống, dự án còn sống và dự án người gọi xem được
   * (`project:view`; theo luật hiện có: quyền cấp workspace có `project:view` = thấy mọi dự án). MỌI đường đọc công việc/trang
   * liên quan trong wiki (get, byIssue) đi qua đây — điểm cắm duy nhất cho dự án riêng tư (P15: thay phần tính
   * `hidden` bằng ProjectAccessService).
   */
  async visibleIssueFilter(
    viewer: WikiActor,
    workspaceId: string,
  ): Promise<{ deletedAt: null; project: { deletedAt: null; id?: { notIn: string[] } } }> {
    const hidden: string[] = [];
    if (!viewer.isSystemAdmin) {
      const wsPerms = await this.rbac.getEffectivePermissions(viewer.id, workspaceId, null);
      if (!wsPerms.has(PERMISSIONS.PROJECT_VIEW)) {
        const projects = await this.prisma.project.findMany({
          where: { workspaceId, deletedAt: null },
          select: { id: true },
        });
        for (let i = 0; i < projects.length; i += 10) {
          const chunk = projects.slice(i, i + 10);
          const perms = await Promise.all(
            chunk.map((p) => this.rbac.getEffectivePermissions(viewer.id, workspaceId, p.id)),
          );
          chunk.forEach((p, k) => {
            if (!perms[k]!.has(PERMISSIONS.PROJECT_VIEW)) hidden.push(p.id);
          });
        }
      }
    }
    return {
      deletedAt: null,
      project: { deletedAt: null, ...(hidden.length ? { id: { notIn: hidden } } : {}) },
    };
  }

  /**
   * Ghi lại liên kết trang → công việc theo mã công việc trong nội dung (xoá & ghi lại, nguyên tử).
   * Chạy SAU khi lưu trang: lỗi chỉ log, không làm hỏng việc lưu. Mã giống-mã nhưng không phải
   * công việc (vd "UTF-8") bị loại ở truy vấn.
   */
  private async syncIssueLinks(workspaceId: string, pageId: string, body: string): Promise<void> {
    try {
      const keys = extractIssueKeys(body, MAX_LINKED_ISSUES);
      const issues = keys.length
        ? await this.prisma.issue.findMany({
            where: {
              workspaceId,
              key: { in: keys },
              deletedAt: null,
              project: { deletedAt: null },
            },
            select: { id: true },
          })
        : [];
      await this.prisma.$transaction([
        this.prisma.wikiPageIssue.deleteMany({ where: { wikiPageId: pageId } }),
        ...(issues.length
          ? [
              this.prisma.wikiPageIssue.createMany({
                data: issues.map((i) => ({ wikiPageId: pageId, issueId: i.id })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    } catch (e) {
      this.logger.warn(`Không đồng bộ được liên kết công việc của trang ${pageId}: ${String(e)}`);
    }
  }

  private scopeWhere(projectId?: string) {
    if (!projectId) return {};
    if (projectId === SCOPE_WORKSPACE) return { projectId: null };
    return { projectId };
  }

  private async requirePage(workspaceId: string, id: string) {
    const page = await this.prisma.wikiPage.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        title: true,
        order: true,
        updatedAt: true,
      },
    });
    if (!page) throw new NotFoundAppException('Trang tài liệu');
    return page;
  }

  /** Như `requirePage` nhưng cho thao tác ghi: trang của dự án đã lưu trữ là chỉ đọc. */
  private async requireWritablePage(workspaceId: string, id: string) {
    const page = await this.requirePage(workspaceId, id);
    await assertProjectIdWritable(this.prisma, page.projectId);
    return page;
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true, archivedAt: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    assertNotArchived(p.archivedAt);
    return p;
  }

  private async nextOrder(
    workspaceId: string,
    projectId: string | null,
    parentId: string | null,
  ): Promise<number> {
    const last = await this.prisma.wikiPage.findFirst({
      where: { workspaceId, projectId, parentId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (last?.order ?? -1) + 1;
  }

  private async renumber(
    workspaceId: string,
    projectId: string | null,
    parentId: string | null,
  ): Promise<void> {
    const rows = await this.prisma.wikiPage.findMany({
      where: { workspaceId, projectId, parentId },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
      select: { id: true, order: true, updatedAt: true },
    });
    // Chỉ ghi hàng lệch số thứ tự, giữ nguyên `updatedAt` (xem `move`).
    const writes = rows.flatMap((r, idx) =>
      r.order === idx
        ? []
        : [
            this.prisma.wikiPage.update({
              where: { id: r.id },
              data: { order: idx, updatedAt: r.updatedAt },
            }),
          ],
    );
    if (writes.length) await this.prisma.$transaction(writes);
  }

  /** `candidateId` có nằm trong nhánh con của `rootId` không (đi ngược lên theo parent). */
  private async isDescendant(
    workspaceId: string,
    candidateId: string,
    rootId: string,
  ): Promise<boolean> {
    let cursor: string | null = candidateId;
    for (let depth = 0; cursor && depth < 100; depth += 1) {
      const row: { parentId: string | null } | null = await this.prisma.wikiPage.findFirst({
        where: { id: cursor, workspaceId },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
      if (cursor === rootId) return true;
    }
    return false;
  }

  private async ancestors(
    workspaceId: string,
    parentId: string | null,
  ): Promise<{ id: string; title: string }[]> {
    const chain: { id: string; title: string }[] = [];
    let cursor = parentId;
    for (let depth = 0; cursor && depth < 100; depth += 1) {
      const row: { id: string; title: string; parentId: string | null } | null =
        await this.prisma.wikiPage.findFirst({
          where: { id: cursor, workspaceId },
          select: { id: true, title: true, parentId: true },
        });
      if (!row) break;
      chain.unshift({ id: row.id, title: row.title });
      cursor = row.parentId;
    }
    return chain;
  }

  private buildTree(rows: NodeRow[]): WikiNodeDto[] {
    const nodes = new Map<string, WikiNodeDto>();
    for (const r of rows) {
      nodes.set(r.id, {
        id: r.id,
        projectId: r.projectId,
        parentId: r.parentId,
        title: r.title,
        order: r.order,
        updatedAt: r.updatedAt.toISOString(),
        children: [],
      });
    }
    const roots: WikiNodeDto[] = [];
    for (const r of rows) {
      const node = nodes.get(r.id)!;
      const parent = r.parentId ? nodes.get(r.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node); // cha nằm ngoài phạm vi lọc → coi như gốc
    }
    return roots;
  }

  /** Đoạn trích ~160 ký tự quanh vị trí khớp đầu tiên trong nội dung. */
  private snippet(body: string, term: string): string {
    const idx = body.toLowerCase().indexOf(term.toLowerCase());
    if (idx < 0) return '';
    const start = Math.max(0, idx - 60);
    const text = body
      .slice(start, start + 160)
      .replace(/\s+/g, ' ')
      .trim();
    return `${start > 0 ? '…' : ''}${text}${start + 160 < body.length ? '…' : ''}`;
  }
}
