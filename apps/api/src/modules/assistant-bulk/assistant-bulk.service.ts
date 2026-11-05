import { HttpException, Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type AssistantBulkAssignResult,
  type AssistantBulkAssignRowInput,
  type AssistantBulkAssignRowResult,
  type AssistantBulkMemberRowInput,
  type AssistantBulkMemberRowResult,
  type AssistantBulkMembersResult,
} from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthUser } from '../../common/types/request';
import { RbacService } from '../rbac/rbac.service';
import { IssuesService } from '../issues/issues.service';
import { MembersService } from '../members/members.service';

/** Mỗi lần gọi `IssuesService.bulkUpdate` tối đa chừng này việc (giới hạn của sửa hàng loạt). */
const BULK_CHUNK = 100;

/** Lý do tiếng Việt từ một exception (AppException mang `message` trong body). */
function reasonOf(e: unknown): string {
  if (e instanceof HttpException) {
    const body = e.getResponse();
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string')
      return body.message;
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : 'Không thực hiện được';
}

const sameSet = (a: readonly string[] | null, b: readonly string[] | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
};

/**
 * Thực hiện lệnh hàng loạt của Trợ lý. Nguyên tắc: (1) quyền kiểm TỪNG DÒNG, từng dự án, ở đây — không tin web; dòng thiếu
 * quyền KHÔNG BAO GIỜ chạm vào dữ liệu; (2) dùng lại dịch vụ sẵn có (`IssuesService.bulkUpdate`, `MembersService`) nên mọi
 * kiểm tra/nhật ký/sự kiện của chúng vẫn áp; (3) một dòng lỗi không làm hỏng cả lô — trả kết quả từng dòng; (4) OCC: dòng
 * đã đổi từ lúc xem trước thì bỏ qua (không ghi đè) — nhờ đó Hoàn tác chỉ khôi phục đúng phần mình đã đổi.
 */
@Injectable()
export class AssistantBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly issues: IssuesService,
    private readonly members: MembersService,
  ) {}

  /** Quyền hiệu lực của người gọi ở một dự án; `null` = không xem được dự án (coi như không tồn tại). */
  private async projectPerms(
    organizationId: string,
    user: AuthUser,
    projectId: string,
  ): Promise<Set<string> | null> {
    if (user.isSystemAdmin) return new Set<string>(Object.values(PERMISSIONS));
    try {
      await this.rbac.assertProjectVisible(user.id, organizationId, projectId, 'Dự án', false);
    } catch {
      return null;
    }
    return this.rbac.getEffectivePermissions(user.id, organizationId, projectId);
  }

  async assign(
    organizationId: string,
    user: AuthUser,
    rows: AssistantBulkAssignRowInput[],
  ): Promise<AssistantBulkAssignResult> {
    const ids = [...new Set(rows.map((r) => r.issueId))];
    const found = await this.prisma.issue.findMany({
      where: { id: { in: ids }, organizationId, deletedAt: null },
      select: { id: true, key: true, projectId: true, assigneeId: true, version: true },
    });
    const byId = new Map(found.map((i) => [i.id, i]));
    const perms = new Map<string, Set<string> | null>();
    for (const projectId of new Set(found.map((i) => i.projectId)))
      perms.set(projectId, await this.projectPerms(organizationId, user, projectId));

    const results = new Map<string, AssistantBulkAssignRowResult>();
    const assignable = new Map<string, Promise<boolean>>();
    const eligible: Array<{ row: AssistantBulkAssignRowInput; projectId: string }> = [];
    const seen = new Set<string>();

    const skip = (
      row: AssistantBulkAssignRowInput,
      reason: string,
      status: 'skipped' | 'failed' = 'skipped',
    ): void => {
      const issue = byId.get(row.issueId);
      results.set(row.issueId, {
        issueId: row.issueId,
        key: issue?.key ?? null,
        status,
        reason,
        previousAssigneeId: issue?.assigneeId ?? null,
        assigneeId: issue?.assigneeId ?? null,
        version: issue?.version ?? null,
      });
    };

    for (const row of rows) {
      if (seen.has(row.issueId)) continue; // dòng trùng: giữ dòng đầu
      seen.add(row.issueId);
      const issue = byId.get(row.issueId);
      const p = issue ? perms.get(issue.projectId) : undefined;
      if (!issue || !p) {
        skip(row, 'Không tìm thấy việc này (sai mã hoặc bạn không có quyền xem).');
        continue;
      }
      if (!p.has(PERMISSIONS.ISSUE_ASSIGN) || !p.has(PERMISSIONS.ISSUE_EDIT)) {
        skip(row, `Bạn không đủ quyền giao việc ở dự án của ${issue.key}.`);
        continue;
      }
      if (issue.assigneeId === row.assigneeId) {
        skip(row, 'Người này đã là người phụ trách — không cần đổi.');
        continue;
      }
      if (issue.version !== row.version) {
        skip(row, 'Việc đã được sửa sau lúc xem trước — mình không ghi đè.');
        continue;
      }
      if (row.assigneeId) {
        const k = `${issue.projectId}:${row.assigneeId}`;
        if (!assignable.has(k))
          assignable.set(
            k,
            this.issues.isAssignableMember(
              organizationId,
              row.assigneeId,
              this.prisma,
              issue.projectId,
            ),
          );
        if (!(await assignable.get(k))) {
          skip(row, 'Người nhận không thuộc tổ chức hoặc không xem được dự án này.');
          continue;
        }
      }
      eligible.push({ row, projectId: issue.projectId });
    }

    // Nhóm theo (dự án, người nhận) → mỗi nhóm một lần sửa hàng loạt (tối đa BULK_CHUNK việc).
    const groups = new Map<string, typeof eligible>();
    for (const e of eligible) {
      const k = `${e.projectId}\n${e.row.assigneeId ?? ''}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += BULK_CHUNK) {
        const chunk = group.slice(i, i + BULK_CHUNK);
        const { projectId } = chunk[0]!;
        try {
          const res = await this.issues.bulkUpdate(
            organizationId,
            user.id,
            {
              projectId,
              items: chunk.map((c) => ({ id: c.row.issueId, version: c.row.version })),
              patch: { assigneeId: chunk[0]!.row.assigneeId },
            },
            false,
          );
          const updated = new Map(res.updated.map((u) => [u.id, u]));
          const conflicts = new Map(res.conflicts.map((c) => [c.id, c.version]));
          for (const { row } of chunk) {
            const before = byId.get(row.issueId)!;
            const u = updated.get(row.issueId);
            if (conflicts.has(row.issueId) || !u) {
              results.set(row.issueId, {
                issueId: row.issueId,
                key: before.key,
                status: 'skipped',
                reason: 'Việc đã được sửa sau lúc xem trước — mình không ghi đè.',
                previousAssigneeId: before.assigneeId,
                assigneeId: before.assigneeId,
                version: conflicts.get(row.issueId) ?? before.version,
              });
              continue;
            }
            results.set(row.issueId, {
              issueId: row.issueId,
              key: before.key,
              status: 'ok',
              previousAssigneeId: before.assigneeId,
              assigneeId: u.assigneeId ?? null,
              version: u.version,
            });
          }
        } catch (e) {
          // Lỗi cả nhóm (vd dự án đã lưu trữ): chưa ghi gì cho nhóm này (bulkUpdate kiểm trước khi ghi / trong transaction).
          for (const { row } of chunk) skip(row, reasonOf(e), 'failed');
        }
      }
    }
    return {
      results: rows
        .filter((r, i) => rows.findIndex((o) => o.issueId === r.issueId) === i)
        .map((r) => results.get(r.issueId)!),
    };
  }

  async setMembers(
    organizationId: string,
    user: AuthUser,
    rows: AssistantBulkMemberRowInput[],
  ): Promise<AssistantBulkMembersResult> {
    const byProject = new Map<string, AssistantBulkMemberRowInput[]>();
    for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
    const out = new Map<string, AssistantBulkMemberRowResult>();
    const keyOf = (r: { projectId: string; userId: string }) => `${r.projectId}\n${r.userId}`;
    const put = (
      r: AssistantBulkMemberRowInput,
      status: AssistantBulkMemberRowResult['status'],
      before: string[] | null,
      after: string[] | null,
      reason?: string,
    ): void => {
      out.set(keyOf(r), {
        projectId: r.projectId,
        userId: r.userId,
        status,
        ...(reason ? { reason } : {}),
        before,
        after,
      });
    };

    for (const [projectId, list] of byProject) {
      const perms = await this.projectPerms(organizationId, user, projectId);
      if (!perms) {
        for (const r of list)
          put(r, 'skipped', null, null, 'Không tìm thấy dự án (hoặc bạn không xem được).');
        continue;
      }
      if (!perms.has(PERMISSIONS.PROJECT_ADMIN)) {
        for (const r of list)
          put(r, 'skipped', null, null, 'Bạn không phải quản trị của dự án này.');
        continue;
      }
      // Trạng thái hiện tại của cả dự án (một lần): vai trò riêng + vai trò hiệu lực theo mặc định tổ chức.
      let state: Awaited<ReturnType<MembersService['listProject']>>;
      try {
        state = await this.members.listProject(organizationId, projectId);
      } catch (e) {
        for (const r of list) put(r, 'failed', null, null, reasonOf(e));
        continue;
      }
      const stateOf = new Map(state.map((m) => [m.user.id, m]));
      const seen = new Set<string>();
      for (const r of list) {
        if (seen.has(r.userId)) continue; // dòng trùng: giữ dòng đầu
        seen.add(r.userId);
        const m = stateOf.get(r.userId);
        const current: string[] | null = m?.isOverride ? m.roles.map((x) => x.id) : null;
        if (!sameSet(current, r.expect)) {
          put(r, 'skipped', current, current, 'Vai trò của người này đã đổi sau lúc xem trước.');
          continue;
        }
        if (r.set === null && current === null) {
          put(r, 'skipped', null, null, 'Không có vai trò riêng để gỡ.');
          continue;
        }
        if (r.set !== null && sameSet(current, r.set)) {
          put(r, 'skipped', current, current, 'Đã có đúng vai trò này.');
          continue;
        }
        if (
          r.set !== null &&
          current === null &&
          m &&
          sameSet(
            m.roles.map((x) => x.id),
            r.set,
          )
        ) {
          put(
            r,
            'skipped',
            null,
            null,
            'Đã có đúng vai trò này (theo vai trò mặc định của tổ chức).',
          );
          continue;
        }
        try {
          if (r.set === null)
            await this.members.clearProjectOverride(organizationId, projectId, r.userId, user.id);
          else
            await this.members.setProjectRoles(organizationId, projectId, r.userId, r.set, user.id);
          put(r, 'ok', current, r.set);
        } catch (e) {
          put(r, 'failed', current, current, reasonOf(e));
        }
      }
    }
    const order = new Set<string>();
    return {
      results: rows.flatMap((r) => {
        const k = keyOf(r);
        if (order.has(k)) return [];
        order.add(k);
        return [out.get(k)!];
      }),
    };
  }
}
