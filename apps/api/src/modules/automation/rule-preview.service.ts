import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  JqlParseError,
  containsUnstorableText,
  parseJql,
  type PreviewMatchInput,
  type PreviewMatchResult,
} from '@tirapro/shared';
import { BOUNDED_COUNT_DEADLINE_MS, boundedIssueCount } from '../../common/bounded-count';
import { WRITABLE_PROJECT_FILTER } from '../../common/project-writable';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { compileJql, jqlDependsOnViewer } from '../search/jql-compiler';
import { fieldConditionToWhere, isJqlCondition } from './rule-conditions';

const UNSUPPORTED = 'không xem trước được điều kiện này';
const UNSUPPORTED_NON_LATIN = `${UNSUPPORTED} (chỉ hỗ trợ chữ Latin)`;
const UNSTORABLE = 'điều kiện chứa ký tự không hợp lệ';
const none = (over: Partial<PreviewMatchResult>): PreviewMatchResult => ({
  count: null,
  reason: null,
  timedOut: false,
  currentUserInJql: false,
  ...over,
});

/**
 * "Khớp N việc hiện có" cho điều kiện quy tắc tự động hoá (132b).
 * - Điều kiện trường → `fieldConditionToWhere` (có spec đối chứng với `evalFieldCondition` của engine); điều kiện JQL →
 *   `compileJql(parseJql(jql), { currentUserId: <người dùng hệ thống> })` đúng như `RuleEngineService.matchesJql`.
 * - RIÊNG TƯ: chỉ đếm trong phạm vi NGƯỜI SOẠN thấy (`visibleWhere`, xoá mềm, dự án chưa lưu trữ) — KHÔNG bao giờ đếm bằng
 *   quyền hệ thống, nên số xem trước ≤ số chạy thật (engine chạy trên mọi dự án) và không lộ "có N việc" ở dự án riêng tư.
 * - Tài nguyên: một lần đếm duy nhất qua `boundedIssueCount` (semaphore chung cả tiến trình + statement_timeout + hạn tổng).
 */
@Injectable()
export class RulePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async previewMatch(
    workspaceId: string,
    userId: string,
    input: PreviewMatchInput,
  ): Promise<PreviewMatchResult> {
    // Route đã chặn bằng schema (400); đây là chốt cho mọi đường gọi khác — Postgres không nhận NUL/UTF-16 hỏng (sẽ thành 500).
    if (input.conditions.some((c) => containsUnstorableText(c))) {
      return none({ reason: UNSTORABLE });
    }
    const hasJql = input.conditions.some(isJqlCondition);
    const systemId = hasJql ? await this.systemUserId() : '';

    const wheres: Prisma.IssueWhereInput[] = [];
    let currentUserInJql = false;
    for (const c of input.conditions) {
      if (isJqlCondition(c)) {
        let ast;
        try {
          ast = parseJql(c.jql);
        } catch (e) {
          if (e instanceof JqlParseError) {
            return none({ reason: `JQL không hợp lệ: ${e.message} (vị trí ${e.position})` });
          }
          throw e;
        }
        currentUserInJql ||= jqlDependsOnViewer(ast.where);
        wheres.push(compileJql(ast, { currentUserId: systemId }).where);
      } else {
        const where = fieldConditionToWhere(c);
        // `contains` trên chữ (không phải ngày) chỉ trả null vì có chữ ngoài tập gấp-hoa-thường chắc chắn → gợi ý cho người soạn.
        if (!where)
          return none({
            reason:
              c.op === 'contains' && c.field !== 'dueDate' ? UNSUPPORTED_NON_LATIN : UNSUPPORTED,
          });
        wheres.push(where);
      }
    }

    const visible = await this.access.visibleWhere(userId, workspaceId);
    const where: Prisma.IssueWhereInput = {
      workspaceId,
      deletedAt: null,
      project: { ...WRITABLE_PROJECT_FILTER, ...visible },
      ...(input.projectId ? { projectId: input.projectId } : {}),
      AND: wheres,
    };
    const count = await boundedIssueCount(
      this.prisma,
      where,
      Date.now() + BOUNDED_COUNT_DEADLINE_MS,
    );
    return count === null
      ? none({ timedOut: true, currentUserInJql })
      : none({ count, currentUserInJql });
  }

  /** Id người dùng hệ thống (chỉ tra, không tạo). Chưa có → '' (không ai khớp `currentUser()`, như engine chưa gán cho ai). */
  private async systemUserId(): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: SYSTEM_USER_EMAIL },
      select: { id: true },
    });
    return user?.id ?? '';
  }
}
