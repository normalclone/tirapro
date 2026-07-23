import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';

/** Loại liên kết khả dụng trong workspace. */
export interface LinkTypeView {
  id: string;
  name: string;
  outwardName: string;
  inwardName: string;
}

/** Issue ở đầu kia của liên kết (không phải issue đang xem). */
export interface LinkedIssueView {
  id: string;
  key: string;
  summary: string;
  status: { name: string; category: string };
}

/** Liên kết vừa tạo, kèm loại + tóm tắt issue đích. */
export interface CreatedLinkView {
  id: string;
  sourceIssueId: string;
  targetIssueId: string;
  linkType: LinkTypeView;
  targetIssue: LinkedIssueView;
}

/** Một liên kết nhìn từ góc nhìn của issue đang xem. */
export interface IssueLinkView {
  id: string;
  direction: 'outward' | 'inward';
  relationName: string;
  linkTypeId: string;
  otherIssue: LinkedIssueView;
}

export interface CreateIssueLinkInput {
  targetIssueId: string;
  linkTypeId: string;
}

// Issue tối thiểu cần để hiển thị đầu kia của liên kết.
const linkEndSelect = {
  id: true,
  key: true,
  summary: true,
  status: { select: { name: true, category: true } },
} satisfies Prisma.IssueSelect;

const linkInclude = {
  linkType: true,
  source: { select: linkEndSelect },
  target: { select: linkEndSelect },
} satisfies Prisma.IssueLinkInclude;

type LinkRow = Prisma.IssueLinkGetPayload<{ include: typeof linkInclude }>;
type LinkEndRow = Prisma.IssueGetPayload<{ select: typeof linkEndSelect }>;
type LinkTypeRow = Prisma.LinkTypeGetPayload<true>;

@Injectable()
export class IssueLinksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Danh sách loại liên kết của workspace. */
  async listTypes(workspaceId: string): Promise<LinkTypeView[]> {
    const rows = await this.prisma.linkType.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toTypeView(r));
  }

  /** Tạo liên kết: issue nguồn = issueId, đích = targetIssueId. */
  async create(
    workspaceId: string,
    issueId: string,
    input: CreateIssueLinkInput,
  ): Promise<CreatedLinkView> {
    if (input.targetIssueId === issueId) {
      throw new BusinessRuleException('Không thể liên kết issue với chính nó');
    }

    // Cả hai issue phải thuộc workspace của người dùng.
    await this.requireIssue(workspaceId, issueId);
    const target = await this.requireIssue(workspaceId, input.targetIssueId);

    // Loại liên kết phải thuộc workspace.
    const linkType = await this.prisma.linkType.findFirst({
      where: { id: input.linkTypeId, workspaceId },
    });
    if (!linkType) throw new NotFoundAppException('Loại liên kết');

    try {
      const link = await this.prisma.issueLink.create({
        data: {
          sourceIssueId: issueId,
          targetIssueId: input.targetIssueId,
          linkTypeId: linkType.id,
        },
      });
      return {
        id: link.id,
        sourceIssueId: link.sourceIssueId,
        targetIssueId: link.targetIssueId,
        linkType: this.toTypeView(linkType),
        targetIssue: this.toLinkedIssue(target),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BusinessRuleException('Liên kết đã tồn tại');
      }
      throw e;
    }
  }

  /** Xóa liên kết — issue nguồn của liên kết phải thuộc workspace. */
  async remove(workspaceId: string, linkId: string): Promise<{ success: true }> {
    const link = await this.prisma.issueLink.findFirst({
      where: { id: linkId, source: { workspaceId, deletedAt: null } },
      select: { id: true },
    });
    if (!link) throw new NotFoundAppException('Liên kết');
    await this.prisma.issueLink.delete({ where: { id: link.id } });
    return { success: true };
  }

  /** Tất cả liên kết của issue (nguồn HOẶC đích), chuẩn hóa theo góc nhìn issue. */
  async listForIssue(workspaceId: string, issueId: string): Promise<IssueLinkView[]> {
    await this.requireIssue(workspaceId, issueId);
    const rows = await this.prisma.issueLink.findMany({
      where: { OR: [{ sourceIssueId: issueId }, { targetIssueId: issueId }] },
      include: linkInclude,
      // IssueLink không có cột createdAt trong schema → sắp xếp ổn định theo id.
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => this.toPerspectiveView(issueId, row));
  }

  // ---------- helpers ----------
  private async requireIssue(workspaceId: string, issueId: string): Promise<LinkEndRow> {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: linkEndSelect,
    });
    if (!issue) throw new NotFoundAppException('Issue');
    return issue;
  }

  /** Chuẩn hóa một liên kết theo góc nhìn của issue đang xem. */
  private toPerspectiveView(issueId: string, row: LinkRow): IssueLinkView {
    const isSource = row.sourceIssueId === issueId;
    const direction: 'outward' | 'inward' = isSource ? 'outward' : 'inward';
    const relationName = isSource ? row.linkType.outwardName : row.linkType.inwardName;
    const other = isSource ? row.target : row.source;
    return {
      id: row.id,
      direction,
      relationName,
      linkTypeId: row.linkTypeId,
      otherIssue: this.toLinkedIssue(other),
    };
  }

  private toLinkedIssue(issue: LinkEndRow): LinkedIssueView {
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      status: { name: issue.status.name, category: issue.status.category },
    };
  }

  private toTypeView(row: LinkTypeRow): LinkTypeView {
    return {
      id: row.id,
      name: row.name,
      outwardName: row.outwardName,
      inwardName: row.inwardName,
    };
  }
}
