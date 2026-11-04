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
import { ProjectAccessService } from '../rbac/project-access.service';

/** Loại liên kết khả dụng trong organization. */
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
  /** Công việc đầu kia đã bị xoá (mềm): vẫn hiện liên kết nhưng UI hiển thị "đã xoá", không cho mở. */
  deleted: boolean;
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
  /** 'inward' = công việc `:issueId` là phía ĐÍCH, `targetIssueId` là NGUỒN. Mặc định 'outward'. */
  direction?: 'outward' | 'inward';
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
  deletedAt: true,
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
    // Mặc định dựng từ cùng prisma/rbac (chỗ dựng cũ vẫn chạy); Nest DI tiêm bản thật.
    private readonly access: ProjectAccessService = new ProjectAccessService(prisma, rbac),
  ) {}

  /** Danh sách loại liên kết của organization. */
  async listTypes(organizationId: string): Promise<LinkTypeView[]> {
    const rows = await this.prisma.linkType.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toTypeView(r));
  }

  /**
   * Tạo liên kết. Mặc định (outward) nguồn = issueId, đích = targetIssueId; `direction: 'inward'` hoán đổi vai
   * ("issueId is caused by targetIssueId" ⇒ lưu target causes issueId). Quyền/lưu trữ kiểm như nhau cho cả hai chiều.
   */
  async create(
    organizationId: string,
    issueId: string,
    input: CreateIssueLinkInput,
    actor: LinkActor,
  ): Promise<CreatedLinkView> {
    if (input.targetIssueId === issueId) {
      throw new BusinessRuleException(
        'Không thể liên kết một công việc với chính nó — hãy chọn công việc khác',
      );
    }

    // Cả hai issue phải thuộc tổ chức của người dùng.
    const source = await this.requireIssue(organizationId, issueId);
    // Đích không tồn tại (hoặc đã xoá) bị từ chối cùng lỗi với "không có quyền ở dự án đích" — xem LINK_TARGET_DENIED.
    const target = await this.findIssue(organizationId, input.targetIssueId);
    if (!target) throw new ForbiddenAppException(LINK_TARGET_DENIED);
    // Nguồn: guard đã kiểm quyền; archived của dự án nguồn chặn ngay.
    await assertIssueWritable(this.prisma, issueId);
    // Guard chỉ kiểm quyền ở đầu NGUỒN → link liên dự án phải kiểm thêm quyền ở đầu ĐÍCH.
    // Kiểm quyền TRƯỚC trạng thái lưu trữ của đích để không lộ trạng thái dự án cho người không có quyền.
    if (target.projectId !== source.projectId) {
      // Dự án riêng tư của đích mà người gọi không thấy → cùng lỗi với "đích không tồn tại" (không lộ sự tồn tại).
      if (
        !actor.isSystemAdmin &&
        !(await this.access.canSee(actor.id, organizationId, target.projectId))
      )
        throw new ForbiddenAppException(LINK_TARGET_DENIED);
      await this.assertCanEditAcrossProject(organizationId, actor, target);
    }
    await assertIssueWritable(this.prisma, input.targetIssueId);

    // Loại liên kết phải thuộc organization.
    const linkType = await this.prisma.linkType.findFirst({
      where: { id: input.linkTypeId, organizationId },
    });
    if (!linkType) throw new NotFoundAppException('Loại liên kết');

    const [sourceId, targetId] =
      input.direction === 'inward'
        ? [input.targetIssueId, issueId]
        : [issueId, input.targetIssueId];
    await this.assertNoDuplicateOrReciprocal(sourceId, targetId, linkType, input, source, target);
    try {
      const link = await this.prisma.issueLink.create({
        data: { sourceIssueId: sourceId, targetIssueId: targetId, linkTypeId: linkType.id },
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

  /**
   * Giữa hai công việc chỉ có MỘT liên kết cho mỗi loại, bất kể chiều: đã có `A blocks B` thì không thêm `B blocks A`
   * (cũng không thêm lần nữa `A blocks B`) — tránh vòng "chặn lẫn nhau", "nhân bản lẫn nhau".
   */
  private async assertNoDuplicateOrReciprocal(
    sourceId: string,
    targetId: string,
    linkType: LinkTypeRow,
    input: CreateIssueLinkInput,
    viewing: LinkEndRow,
    other: LinkEndRow,
  ): Promise<void> {
    const existing = await this.prisma.issueLink.findFirst({
      where: {
        linkTypeId: linkType.id,
        OR: [
          { sourceIssueId: sourceId, targetIssueId: targetId },
          { sourceIssueId: targetId, targetIssueId: sourceId },
        ],
      },
      select: { sourceIssueId: true },
    });
    if (!existing) return;
    const sameDirection = existing.sourceIssueId === sourceId;
    const [srcKey, dstKey] =
      input.direction === 'inward' ? [other.key, viewing.key] : [viewing.key, other.key];
    throw new BusinessRuleException(
      sameDirection
        ? `${srcKey} đã có liên kết "${linkType.outwardName}" tới ${dstKey} — không cần tạo lại`
        : `${dstKey} đã có liên kết "${linkType.outwardName}" tới ${srcKey} — không thể tạo thêm liên kết "${linkType.outwardName}" theo chiều ngược lại. Hãy xoá liên kết cũ trước nếu muốn đổi chiều`,
    );
  }

  /** Xóa liên kết — issue nguồn của liên kết phải thuộc organization. */
  async remove(
    organizationId: string,
    linkId: string,
    actor: LinkActor,
  ): Promise<{ success: true }> {
    const link = await this.prisma.issueLink.findFirst({
      // Cho cả liên kết có đầu NGUỒN đã xoá mềm: người dùng cần dọn được liên kết "đã xoá" hiện ở công việc còn lại.
      where: { id: linkId, source: { organizationId } },
      select: {
        id: true,
        sourceIssueId: true,
        targetIssueId: true,
        source: { select: { projectId: true, deletedAt: true } },
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
      await this.assertCanEditAcrossProject(organizationId, actor, link.target);
    }
    // Đầu đã xoá mềm không còn "ghi được" — chỉ kiểm đầu còn sống.
    if (!link.source.deletedAt) await assertIssueWritable(this.prisma, link.sourceIssueId);
    if (!link.target.deletedAt) await assertIssueWritable(this.prisma, link.targetIssueId);
    await this.prisma.issueLink.delete({ where: { id: link.id } });
    return { success: true };
  }

  /** Tất cả liên kết của issue (nguồn HOẶC đích), chuẩn hóa theo góc nhìn issue. */
  async listForIssue(
    organizationId: string,
    issueId: string,
    actor: LinkActor,
  ): Promise<IssueLinkView[]> {
    const self = await this.requireIssue(organizationId, issueId);
    // Giữ link tới issue đã xoá mềm (hiện "đã xoá", logbug #21); chỉ ẩn khi dự án đầu kia đã xoá mềm
    // (IssueLink không có deletedAt → lọc trên quan hệ).
    const liveEnd = { organizationId, ...LIVE_PROJECT };
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
          : await this.rbac.getEffectivePermissions(actor.id, organizationId, other.projectId);
        ok =
          perms === null ||
          (perms.has(PERMISSIONS.PROJECT_VIEW) &&
            (await this.access.canSee(actor.id, organizationId, other.projectId)));
        canView.set(other.projectId, ok);
      }
      if (ok) visible.push(row);
    }
    return visible.map((row) => this.toPerspectiveView(issueId, row));
  }

  // ---------- helpers ----------
  private async findIssue(organizationId: string, issueId: string): Promise<LinkWriteRow | null> {
    return this.prisma.issue.findFirst({
      where: { id: issueId, organizationId, deletedAt: null, ...LIVE_PROJECT },
      select: linkWriteSelect,
    });
  }

  private async requireIssue(organizationId: string, issueId: string): Promise<LinkWriteRow> {
    const issue = await this.findIssue(organizationId, issueId);
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  /** Ở dự án của issue `issue`: cần `issue:edit`, hoặc `issue:edit:own` và là chủ issue đó. */
  private async assertCanEditAcrossProject(
    organizationId: string,
    actor: LinkActor,
    issue: IssueOwners & { projectId: string },
  ): Promise<void> {
    if (actor.isSystemAdmin) return;
    const perms = await this.rbac.getEffectivePermissions(
      actor.id,
      organizationId,
      issue.projectId,
    );
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
      deleted: issue.deletedAt !== null,
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
