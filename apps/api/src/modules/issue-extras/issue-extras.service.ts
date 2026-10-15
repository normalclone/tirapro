import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { toUserDto, USER_DTO_SELECT } from '../../common/mappers/user.mapper';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { assertIssueWritable } from '../../common/project-writable';

/** Người tham gia + checklist của issue. Luôn kiểm tra issue thuộc workspace người gọi. */
@Injectable()
export class IssueExtrasService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireIssue(workspaceId: string, issueId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!issue) throw new NotFoundAppException('Công việc');
    return issue;
  }

  // ───────────── Người tham gia ─────────────

  async listParticipants(workspaceId: string, issueId: string) {
    await this.requireIssue(workspaceId, issueId);
    const rows = await this.prisma.issueParticipant.findMany({
      where: { issueId },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: USER_DTO_SELECT } },
    });
    return rows.map((r) => toUserDto(r.user));
  }

  /** Đặt lại toàn bộ danh sách người tham gia (chỉ nhận thành viên workspace). */
  async setParticipants(workspaceId: string, issueId: string, userIds: string[]) {
    await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    const unique = [...new Set(userIds)];
    if (unique.length > 0) {
      const members = await this.prisma.workspaceMembership.findMany({
        where: { workspaceId, userId: { in: unique } },
        select: { userId: true },
      });
      if (members.length !== unique.length) {
        throw new ForbiddenAppException(
          'Một số người dùng không thuộc không gian làm việc này — hãy chọn lại từ danh sách thành viên',
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.issueParticipant.deleteMany({ where: { issueId } }),
      ...(unique.length
        ? [
            this.prisma.issueParticipant.createMany({
              data: unique.map((userId) => ({ issueId, userId })),
            }),
          ]
        : []),
    ]);
    return this.listParticipants(workspaceId, issueId);
  }

  // ───────────── Checklist ─────────────

  async listChecklist(workspaceId: string, issueId: string) {
    await this.requireIssue(workspaceId, issueId);
    return this.prisma.checklistItem.findMany({
      where: { issueId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async addChecklistItem(workspaceId: string, issueId: string, text: string) {
    await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    const last = await this.prisma.checklistItem.findFirst({
      where: { issueId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return this.prisma.checklistItem.create({
      data: { issueId, text: text.trim(), order: (last?.order ?? -1) + 1 },
    });
  }

  async updateChecklistItem(
    workspaceId: string,
    issueId: string,
    itemId: string,
    patch: { text?: string; done?: boolean; order?: number },
  ) {
    await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    const item = await this.prisma.checklistItem.findFirst({
      where: { id: itemId, issueId },
      select: { id: true },
    });
    if (!item) throw new NotFoundAppException('Mục checklist');
    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
        ...(patch.done !== undefined ? { done: patch.done } : {}),
        ...(patch.order !== undefined ? { order: patch.order } : {}),
      },
    });
  }

  async removeChecklistItem(workspaceId: string, issueId: string, itemId: string) {
    await this.requireIssue(workspaceId, issueId);
    await assertIssueWritable(this.prisma, issueId);
    await this.prisma.checklistItem.deleteMany({ where: { id: itemId, issueId } });
    return { success: true };
  }
}
