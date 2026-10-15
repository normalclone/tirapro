import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { LIVE_PROJECT } from '../../common/live-project';
import { assertIssueWritable } from '../../common/project-writable';
import { isIssueOwner, type IssueOwners } from '../rbac/issue-ownership.service';
import { RbacService } from '../rbac/rbac.service';

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

// Cùng một lời từ chối cho "đích không tồn tại / đã xoá / dự án đã xoá" và "không có quyền ở dự án đích",
// để người không có quyền không dò được sự tồn tại của issue ở dự án họ không thuộc.
const LINK_TARGET_DENIED =
  'Không tìm thấy công việc đích, hoặc bạn không có quyền sửa công việc ở dự án còn lại của liên kết — hãy nhờ quản trị viên dự án đó cấp quyền hoặc chọn công việc cùng dự án';

// Issue tối thiểu cần để hiển thị đầu kia của liên kết (projectId để kiểm quyền xem khi liệt kê).
const linkEndSelect = {
  id: true,
  key: true,
  summary: true,
  projectId: true,
  status: { select: { name: true, category: true } },
} satisfies Prisma.IssueSelect;

// Thêm dự án + 3 cột chủ sở hữu để kiểm quyền sửa ở đầu kia của link liên dự án.
const linkWriteSelect = {
  ...linkEndSelect,
  reporterId: true,
  assigneeId: true,
  createdById: true,
} satisfies Prisma.IssueSelect;

const linkInclude = {
  linkType: true,
  source: { select: linkEndSelect },
  target: { select: linkEndSelect },
} satisfies Prisma.IssueLinkInclude;

type LinkRow = Prisma.IssueLinkGetPayload<{ include: typeof linkInclude }>;
type LinkEndRow = Prisma.IssueGetPayload<{ select: typeof linkEndSelect }>;
type LinkWriteRow = Prisma.IssueGetPayload<{ select: typeof linkWriteSelect }>;
export type LinkActor = { id: string; isSystemAdmin: boolean };
type LinkTypeRow = Prisma.LinkTypeGetPayload<true>;

@Injectable()
export class IssueLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

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
    actor: LinkActor,
  ): Promise<CreatedLinkView> {
    if (input.targetIssueId === issueId) {
      throw new BusinessRuleException(
        'Không thể liên kết một công việc với chính nó — hãy chọn công việc khác',
      );
    }

    // Cả hai issue phải thuộc workspace của người dùng.
    const source = await this.requireIssue(workspaceId, issueId);
    // Đích không tồn tại (hoặc đã xoá) bị từ chối cùng lỗi với "không có quyền ở dự án đích" — xem LINK_TARGET_DENIED.
    const target = await this.findIssue(workspaceId, input.targetIssueId);
    if (!target) throw new ForbiddenAppException(LINK_TARGET_DENIED);
    // Nguồn: guard đã kiểm quyền; archived của dự án nguồn chặn ngay.
    await assertIssueWritable(this.prisma, issueId);
    // Guard chỉ kiểm quyền ở đầu NGUỒN → link liên dự án phải kiểm thêm quyền ở đầu ĐÍCH.
    // Kiểm quyền TRƯỚC trạng thái lưu trữ của đích để không lộ trạng thái dự án cho người không có quyền.
    if (target.projectId !== source.projectId) {
      await this.assertCanEditAcrossProject(workspaceId, actor, target);
    }
    await assertIssueWritable(this.prisma, input.targetIssueId);

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
  async remove(workspaceId: string, linkId: string, actor: LinkActor): Promise<{ success: true }> {
    const link = await this.prisma.issueLink.findFirst({
      where: { id: linkId, source: { workspaceId, deletedAt: null } },
      select: {
        id: true,
        sourceIssueId: true,
        targetIssueId: true,
        source: { select: { projectId: true } },
        target: {
          select: {
            id: true,
            projectId: true,
            deletedAt: true,
            reporterId: true,
            assigneeId: true,
            createdById: true,
          },
        },
      },
    });
    if (!link) throw new NotFoundAppException('Liên kết');
    // Issue đích đã xoá mềm → cho dọn link mồ côi, không đòi quyền ở đầu đó. `listForIssue` đã ẩn loại link này
    // nên UI không còn nút xoá cho chúng; nhánh này chỉ còn tới được khi gọi API trực tiếp với id link.
    if (!link.target.deletedAt && link.target.projectId !== link.source.projectId) {
      await this.assertCanEditAcrossProject(workspaceId, actor, link.target);
    }
    await assertIssueWritable(this.prisma, link.sourceIssueId);
    await assertIssueWritable(this.prisma, link.targetIssueId);
    await this.prisma.issueLink.delete({ where: { id: link.id } });
    return { success: true };
  }

  /** Tất cả liên kết của issue (nguồn HOẶC đích), chuẩn hóa theo góc nhìn issue. */
  async listForIssue(
    workspaceId: string,
    issueId: string,
    actor: LinkActor,
  ): Promise<IssueLinkView[]> {
    const self = await this.requireIssue(workspaceId, issueId);
    // Ẩn link tới issue đã xoá mềm / thuộc dự án đã xoá mềm (IssueLink không có deletedAt → lọc trên quan hệ).
    const liveEnd = { workspaceId, deletedAt: null, ...LIVE_PROJECT };
    const rows = await this.prisma.issueLink.findMany({
      where: {
        OR: [
          { sourceIssueId: issueId, target: liveEnd },
          { targetIssueId: issueId, source: liveEnd },
        ],
      },
      include: linkInclude,
      // IssueLink không có cột createdAt trong schema → sắp xếp ổn định theo id.
      orderBy: { id: 'asc' },
    });
    // Ẩn hẳn link mà người gọi không xem được dự án đầu kia. Mỗi dự án tra quyền một lần;
    // cùng dự án với issue đang xem thì guard đã kiểm.
    const canView = new Map<string, boolean>([[self.projectId, true]]);
    const visible: LinkRow[] = [];
    for (const row of rows) {
      const other = row.sourceIssueId === issueId ? row.target : row.source;
      let ok = canView.get(other.projectId);
      if (ok === undefined) {
        // Tuần tự có chủ ý: chỉ vài dự án khác nhau, kết quả cache theo canView.
        const perms = actor.isSystemAdmin
          ? null
          : await this.rbac.getEffectivePermissions(actor.id, workspaceId, other.projectId);
        ok = perms === null || perms.has(PERMISSIONS.PROJECT_VIEW);
        canView.set(other.projectId, ok);
      }
      if (ok) visible.push(row);
    }
    return visible.map((row) => this.toPerspectiveView(issueId, row));
  }

  // ---------- helpers ----------
  private async findIssue(workspaceId: string, issueId: string): Promise<LinkWriteRow | null> {
    return this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null, ...LIVE_PROJECT },
      select: linkWriteSelect,
    });
  }

  private async requireIssue(workspaceId: string, issueId: string): Promise<LinkWriteRow> {
    const issue = await this.findIssue(workspaceId, issueId);
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  /** Ở dự án của issue `issue`: cần `issue:edit`, hoặc `issue:edit:own` và là chủ issue đó. */
  private async assertCanEditAcrossProject(
    workspaceId: string,
    actor: LinkActor,
    issue: IssueOwners & { projectId: string },
  ): Promise<void> {
    if (actor.isSystemAdmin) return;
    const perms = await this.rbac.getEffectivePermissions(actor.id, workspaceId, issue.projectId);
    if (perms.has(PERMISSIONS.ISSUE_EDIT)) return;
    if (perms.has(`${PERMISSIONS.ISSUE_EDIT}:own`) && isIssueOwner(actor.id, issue)) return;
    throw new ForbiddenAppException(LINK_TARGET_DENIED);
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
