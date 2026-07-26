import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import type { CreateWikiPageInput, MoveWikiPageInput, UpdateWikiPageInput } from './wiki.schemas';

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

export interface WikiNodeDto {
  id: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  order: number;
  updatedAt: string;
  children: WikiNodeDto[];
}

export interface WikiPageDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  body: string;
  order: number;
  createdBy: { id: string; displayName: string } | null;
  updatedBy: { id: string; displayName: string } | null;
  /** Đường dẫn từ gốc tới trang (không gồm chính nó) — dùng cho breadcrumb. */
  breadcrumb: { id: string; title: string }[];
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
 * Đọc = workspace:view, ghi = wiki:manage (guard ở controller).
 */
@Injectable()
export class WikiService {
  constructor(private readonly prisma: PrismaService) {}

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
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { body: { contains: term, mode: 'insensitive' } },
        ],
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

  async get(workspaceId: string, id: string): Promise<WikiPageDto> {
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

    return {
      id: page.id,
      workspaceId: page.workspaceId,
      projectId: page.projectId,
      parentId: page.parentId,
      title: page.title,
      body: page.body,
      order: page.order,
      createdBy: (page.createdById && byId.get(page.createdById)) || null,
      updatedBy: (page.updatedById && byId.get(page.updatedById)) || null,
      breadcrumb,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  async create(workspaceId: string, dto: CreateWikiPageInput, actingUserId: string): Promise<WikiPageDto> {
    const title = dto.title.trim();
    if (!title) throw new BusinessRuleException('Tiêu đề bắt buộc');

    let projectId = dto.projectId ?? null;
    const parentId = dto.parentId ?? null;
    if (parentId) {
      const parent = await this.requirePage(workspaceId, parentId);
      projectId = parent.projectId; // trang con luôn cùng phạm vi với trang cha
    } else if (projectId) {
      await this.requireProject(workspaceId, projectId);
    }

    const created = await this.prisma.wikiPage.create({
      data: {
        workspaceId,
        projectId,
        parentId,
        title,
        body: dto.body ?? '',
        order: await this.nextOrder(workspaceId, projectId, parentId),
        createdById: actingUserId,
        updatedById: actingUserId,
      },
      select: { id: true },
    });
    return this.get(workspaceId, created.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateWikiPageInput, actingUserId: string): Promise<WikiPageDto> {
    await this.requirePage(workspaceId, id);
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) throw new BusinessRuleException('Tiêu đề bắt buộc');
    await this.prisma.wikiPage.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        updatedById: actingUserId,
      },
    });
    return this.get(workspaceId, id);
  }

  /**
   * Đổi trang cha và/hoặc vị trí trong danh sách anh em.
   * Chặn chu trình (không cho chuyển vào chính nó hoặc con cháu của nó);
   * đánh lại `order` liên tục 0..n cho nhóm anh em cũ và mới.
   */
  async move(workspaceId: string, id: string, dto: MoveWikiPageInput, actingUserId: string): Promise<WikiNodeDto[]> {
    const page = await this.requirePage(workspaceId, id);
    const nextParentId = dto.parentId === undefined ? page.parentId : dto.parentId;

    if (nextParentId === id) throw new BusinessRuleException('Không thể chuyển trang vào chính nó');
    if (nextParentId) {
      const parent = await this.requirePage(workspaceId, nextParentId);
      if (parent.projectId !== page.projectId) {
        throw new BusinessRuleException('Chỉ chuyển được trong cùng phạm vi (workspace hoặc cùng dự án)');
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
      select: { id: true },
    });
    const target = Math.min(Math.max(dto.order ?? siblings.length, 0), siblings.length);
    const ordered = [...siblings.slice(0, target).map((s) => s.id), id, ...siblings.slice(target).map((s) => s.id)];

    await this.prisma.$transaction([
      this.prisma.wikiPage.update({
        where: { id },
        data: { parentId: nextParentId, updatedById: actingUserId },
      }),
      ...ordered.map((pid, idx) =>
        this.prisma.wikiPage.update({ where: { id: pid }, data: { order: idx } }),
      ),
    ]);

    // Nhóm anh em cũ có thể thủng số thứ tự → đánh lại cho gọn.
    if (page.parentId !== nextParentId) await this.renumber(workspaceId, page.projectId, page.parentId);

    return this.tree(workspaceId, page.projectId ?? SCOPE_WORKSPACE);
  }

  /** Xoá trang; các trang con được nâng lên làm con của trang cha (không mất dữ liệu). */
  async remove(workspaceId: string, id: string): Promise<{ success: true }> {
    const page = await this.requirePage(workspaceId, id);
    await this.prisma.$transaction([
      this.prisma.wikiPage.updateMany({ where: { parentId: id }, data: { parentId: page.parentId } }),
      this.prisma.wikiPage.delete({ where: { id } }),
    ]);
    await this.renumber(workspaceId, page.projectId, page.parentId);
    return { success: true };
  }

  // ───────────────────────── helpers ─────────────────────────

  private scopeWhere(projectId?: string) {
    if (!projectId) return {};
    if (projectId === SCOPE_WORKSPACE) return { projectId: null };
    return { projectId };
  }

  private async requirePage(workspaceId: string, id: string) {
    const page = await this.prisma.wikiPage.findFirst({
      where: { id, workspaceId },
      select: { id: true, projectId: true, parentId: true, title: true },
    });
    if (!page) throw new NotFoundAppException('Trang tài liệu');
    return page;
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
    return p;
  }

  private async nextOrder(workspaceId: string, projectId: string | null, parentId: string | null): Promise<number> {
    const last = await this.prisma.wikiPage.findFirst({
      where: { workspaceId, projectId, parentId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return (last?.order ?? -1) + 1;
  }

  private async renumber(workspaceId: string, projectId: string | null, parentId: string | null): Promise<void> {
    const rows = await this.prisma.wikiPage.findMany({
      where: { workspaceId, projectId, parentId },
      orderBy: [{ order: 'asc' }, { title: 'asc' }],
      select: { id: true },
    });
    await this.prisma.$transaction(
      rows.map((r, idx) => this.prisma.wikiPage.update({ where: { id: r.id }, data: { order: idx } })),
    );
  }

  /** `candidateId` có nằm trong nhánh con của `rootId` không (đi ngược lên theo parent). */
  private async isDescendant(workspaceId: string, candidateId: string, rootId: string): Promise<boolean> {
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

  private async ancestors(workspaceId: string, parentId: string | null): Promise<{ id: string; title: string }[]> {
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
    const text = body.slice(start, start + 160).replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '…' : ''}${text}${start + 160 < body.length ? '…' : ''}`;
  }
}
