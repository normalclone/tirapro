import { Injectable } from '@nestjs/common';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';

const NOT_OWN_ISSUE_MESSAGE =
  'Bạn chỉ được sửa công việc do mình tạo, báo cáo hoặc được giao — hãy nhờ người phụ trách hoặc quản trị viên dự án';

export interface IssueOwners {
  reporterId: string | null;
  assigneeId: string | null;
  createdById: string | null;
}

const OWNERS = { reporterId: true, assigneeId: true, createdById: true } as const;

/** "Chủ" issue = người báo cáo, người được giao hoặc người tạo. Định nghĩa duy nhất cho mọi kiểm `:own`. */
export const isIssueOwner = (userId: string, i: IssueOwners): boolean =>
  i.reporterId === userId || i.assigneeId === userId || i.createdById === userId;

/** Ném 403 (`NOT_OWN_ISSUE_MESSAGE`) nếu `userId` không phải chủ issue. */
export function assertIssueOwner(userId: string, i: IssueOwners): void {
  if (!isIssueOwner(userId, i)) throw new ForbiddenAppException(NOT_OWN_ISSUE_MESSAGE);
}

/**
 * Kiểm sở hữu cho route chỉ qua `PermissionsGuard` nhờ quyền `:own` (cờ `@OwnOnly`).
 * Mọi hàm `assertOwns*` là no-op (không query) khi `ownOnly=false`; trả 404 nếu đối tượng không
 * tồn tại trong workspace, 403 nếu user không phải chủ issue.
 */
@Injectable()
export class IssueOwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /** Kiểm user là chủ của issue `issueId`. */
  async assertOwnsIssue(
    ownOnly: boolean,
    workspaceId: string,
    userId: string,
    issueId: string,
  ): Promise<void> {
    if (!ownOnly) return;
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: OWNERS,
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    assertIssueOwner(userId, issue);
  }

  /** Kiểm user là chủ của issue chứa tệp đính kèm (trực tiếp hoặc qua comment), không theo người upload. */
  async assertOwnsAttachment(
    ownOnly: boolean,
    workspaceId: string,
    userId: string,
    attachmentId: string,
  ): Promise<void> {
    if (!ownOnly) return;
    const live = { workspaceId, deletedAt: null };
    const att = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, OR: [{ issue: live }, { comment: { issue: live } }] },
      select: { issue: { select: OWNERS }, comment: { select: { issue: { select: OWNERS } } } },
    });
    const issue = att?.issue ?? att?.comment?.issue;
    if (!issue) throw new NotFoundAppException('Tệp đính kèm');
    assertIssueOwner(userId, issue);
  }

  /** Kiểm user là chủ của issue NGUỒN của liên kết `linkId`. */
  async assertOwnsLinkSource(
    ownOnly: boolean,
    workspaceId: string,
    userId: string,
    linkId: string,
  ): Promise<void> {
    if (!ownOnly) return;
    const link = await this.prisma.issueLink.findFirst({
      where: { id: linkId, source: { workspaceId, deletedAt: null } },
      select: { source: { select: OWNERS } },
    });
    if (!link) throw new NotFoundAppException('Liên kết');
    assertIssueOwner(userId, link.source);
  }
}
