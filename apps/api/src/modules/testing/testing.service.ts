import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { IssuesService } from '../issues/issues.service';
import type {
  AddRunCasesInput,
  CreateBugFromExecutionInput,
  CreateTestCaseInput,
  CreateTestRunInput,
  SetExecutionInput,
  UpdateTestCaseInput,
  UpdateTestRunInput,
} from './testing.schemas';

/** Thứ tự & danh sách kết quả — dùng cho tiến độ (đếm theo từng kết quả). */
export const TEST_RESULTS = ['UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const;
export type TestResultKey = (typeof TEST_RESULTS)[number];
export type TestProgress = Record<TestResultKey, number> & { total: number };

const USER_LITE = { id: true, displayName: true, avatarUrl: true, email: true } as const;
type UserLiteRow = { id: string; displayName: string; avatarUrl: string | null; email: string };

const ISSUE_LITE = {
  id: true, key: true, summary: true,
  status: { select: { name: true, category: true } },
  type: { select: { name: true } },
} satisfies Prisma.IssueSelect;
type IssueLiteRow = Prisma.IssueGetPayload<{ select: typeof ISSUE_LITE }>;

const CASE_SELECT = {
  id: true, projectId: true, key: true, title: true, precondition: true, steps: true,
  expected: true, folder: true, createdAt: true, updatedAt: true,
  owner: { select: USER_LITE },
  issues: { select: { issue: { select: ISSUE_LITE } } },
} satisfies Prisma.TestCaseSelect;
type CaseRow = Prisma.TestCaseGetPayload<{ select: typeof CASE_SELECT }>;

/**
 * Quản lý kiểm thử: ca kiểm thử (test case), liên kết ca ↔ issue (traceability),
 * đợt chạy (test run) + lượt chạy (execution) và tạo bug từ ca KHÔNG ĐẠT.
 *
 * Mọi thao tác đều đi qua `requireProject(workspaceId, projectId)` — chống truy cập
 * chéo tenant (dự án phải thuộc workspace trong JWT).
 */
@Injectable()
export class TestingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
  ) {}

  // ─────────────────────────── Ca kiểm thử ───────────────────────────

  async listCases(workspaceId: string, projectId: string, filter: { search?: string; folder?: string }) {
    await this.requireProject(workspaceId, projectId);
    const search = filter.search?.trim();
    const where: Prisma.TestCaseWhereInput = {
      projectId,
      ...(filter.folder ? { folder: filter.folder } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { key: { contains: search, mode: 'insensitive' } },
              { steps: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.testCase.findMany({ where, select: CASE_SELECT });
    return this.sortByKey(rows).map((r) => this.toCaseDto(r));
  }

  /** Danh sách thư mục đang dùng trong dự án (cho bộ lọc & gợi ý nhập). */
  async listFolders(workspaceId: string, projectId: string): Promise<string[]> {
    await this.requireProject(workspaceId, projectId);
    const rows = await this.prisma.testCase.findMany({
      where: { projectId, folder: { not: null } },
      distinct: ['folder'],
      select: { folder: true },
      orderBy: { folder: 'asc' },
    });
    return rows.map((r) => r.folder).filter((f): f is string => !!f && f.trim().length > 0);
  }

  async getCase(workspaceId: string, projectId: string, caseId: string) {
    await this.requireProject(workspaceId, projectId);
    return this.toCaseDto(await this.requireCase(projectId, caseId));
  }

  async createCase(workspaceId: string, projectId: string, dto: CreateTestCaseInput, actingUserId: string) {
    await this.requireProject(workspaceId, projectId);
    const title = dto.title.trim();
    if (!title) throw new BusinessRuleException('Tiêu đề ca kiểm thử bắt buộc');
    const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
    const issueIds = dto.issueIds?.length ? await this.validateIssues(projectId, dto.issueIds) : [];

    // Mã ca kiểm thử "TC-n" đánh số riêng theo dự án; retry nếu đụng unique (2 người tạo cùng lúc).
    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const key = await this.nextCaseKey(projectId);
      try {
        created = await this.prisma.testCase.create({
          data: {
            projectId, key, title,
            precondition: this.clean(dto.precondition),
            steps: this.clean(dto.steps),
            expected: this.clean(dto.expected),
            folder: this.clean(dto.folder),
            ownerId,
            createdById: actingUserId,
          },
          select: { id: true },
        });
      } catch (e) {
        if (!this.isUniqueViolation(e)) throw e;
      }
    }
    if (!created) throw new BusinessRuleException('Không sinh được mã ca kiểm thử, thử lại');

    if (issueIds.length) {
      await this.prisma.testCaseIssue.createMany({
        data: issueIds.map((issueId) => ({ testCaseId: created!.id, issueId })),
        skipDuplicates: true,
      });
    }
    return this.getCase(workspaceId, projectId, created.id);
  }

  async updateCase(workspaceId: string, projectId: string, caseId: string, dto: UpdateTestCaseInput) {
    await this.requireProject(workspaceId, projectId);
    await this.requireCase(projectId, caseId);

    const data: Prisma.TestCaseUpdateInput = {};
    if (dto.title !== undefined && dto.title !== null) {
      const title = dto.title.trim();
      if (!title) throw new BusinessRuleException('Tiêu đề ca kiểm thử bắt buộc');
      data.title = title;
    }
    if (dto.precondition !== undefined) data.precondition = this.clean(dto.precondition);
    if (dto.steps !== undefined) data.steps = this.clean(dto.steps);
    if (dto.expected !== undefined) data.expected = this.clean(dto.expected);
    if (dto.folder !== undefined) data.folder = this.clean(dto.folder);
    if (dto.ownerId !== undefined) {
      const ownerId = await this.resolveOwner(workspaceId, dto.ownerId ?? null);
      data.owner = ownerId ? { connect: { id: ownerId } } : { disconnect: true };
    }

    await this.prisma.testCase.update({ where: { id: caseId }, data });

    if (dto.issueIds !== undefined) {
      const ids = dto.issueIds.length ? await this.validateIssues(projectId, dto.issueIds) : [];
      await this.prisma.$transaction([
        this.prisma.testCaseIssue.deleteMany({ where: { testCaseId: caseId } }),
        this.prisma.testCaseIssue.createMany({
          data: ids.map((issueId) => ({ testCaseId: caseId, issueId })),
          skipDuplicates: true,
        }),
      ]);
    }
    return this.getCase(workspaceId, projectId, caseId);
  }

  async removeCase(workspaceId: string, projectId: string, caseId: string) {
    await this.requireProject(workspaceId, projectId);
    await this.requireCase(projectId, caseId);
    await this.prisma.testCase.delete({ where: { id: caseId } }); // execution & link cascade
    return { success: true };
  }

  /** Gắn issue vào ca kiểm thử (traceability yêu cầu ↔ kiểm thử). */
  async linkIssues(workspaceId: string, projectId: string, caseId: string, issueIds: string[]) {
    await this.requireProject(workspaceId, projectId);
    await this.requireCase(projectId, caseId);
    const ids = await this.validateIssues(projectId, issueIds);
    await this.prisma.testCaseIssue.createMany({
      data: ids.map((issueId) => ({ testCaseId: caseId, issueId })),
      skipDuplicates: true,
    });
    return this.getCase(workspaceId, projectId, caseId);
  }

  async unlinkIssues(workspaceId: string, projectId: string, caseId: string, issueIds: string[]) {
    await this.requireProject(workspaceId, projectId);
    await this.requireCase(projectId, caseId);
    await this.prisma.testCaseIssue.deleteMany({ where: { testCaseId: caseId, issueId: { in: issueIds } } });
    return this.getCase(workspaceId, projectId, caseId);
  }

  // ─────────────────────────── Đợt chạy ───────────────────────────

  async listRuns(workspaceId: string, projectId: string) {
    await this.requireProject(workspaceId, projectId);
    const runs = await this.prisma.testRun.findMany({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, projectId: true, name: true, description: true, startedAt: true, finishedAt: true },
    });
    if (runs.length === 0) return [];

    const grouped = await this.prisma.testExecution.groupBy({
      by: ['runId', 'result'],
      where: { runId: { in: runs.map((r) => r.id) } },
      _count: { _all: true },
    });
    const byRun = new Map<string, TestProgress>();
    for (const g of grouped) {
      const p = byRun.get(g.runId) ?? this.emptyProgress();
      p[g.result as TestResultKey] += g._count._all;
      p.total += g._count._all;
      byRun.set(g.runId, p);
    }
    return runs.map((r) => this.toRunDto(r, byRun.get(r.id) ?? this.emptyProgress()));
  }

  /** Đợt chạy kèm tiến độ + toàn bộ lượt chạy (ca kiểm thử, kết quả, ghi chú, bug). */
  async getRun(workspaceId: string, projectId: string, runId: string) {
    await this.requireProject(workspaceId, projectId);
    const run = await this.requireRun(projectId, runId);

    const executions = await this.prisma.testExecution.findMany({
      where: { runId },
      select: {
        id: true, result: true, note: true, bugIssueId: true, executedAt: true, executedById: true,
        testCase: { select: { id: true, key: true, title: true, folder: true, steps: true, expected: true, precondition: true } },
      },
    });

    // bugIssueId / executedById là cột thường (không có relation trong schema) → nạp rời.
    const bugIds = executions.map((e) => e.bugIssueId).filter((id): id is string => !!id);
    const userIds = executions.map((e) => e.executedById).filter((id): id is string => !!id);
    const bugs: IssueLiteRow[] = bugIds.length
      ? await this.prisma.issue.findMany({ where: { id: { in: bugIds } }, select: ISSUE_LITE })
      : [];
    const users: UserLiteRow[] = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_LITE })
      : [];
    const bugById = new Map(bugs.map((b) => [b.id, b]));
    const userById = new Map(users.map((u) => [u.id, u]));

    const progress = this.emptyProgress();
    for (const e of executions) {
      progress[e.result as TestResultKey] += 1;
      progress.total += 1;
    }

    const rows = executions
      .slice()
      .sort((a, b) => this.keyOrder(a.testCase.key) - this.keyOrder(b.testCase.key));

    return {
      ...this.toRunDto(run, progress),
      executions: rows.map((e) => ({
        id: e.id,
        result: e.result as TestResultKey,
        note: e.note,
        executedAt: e.executedAt?.toISOString() ?? null,
        executedBy: e.executedById ? this.toUserLite(userById.get(e.executedById)) : null,
        bugIssue: e.bugIssueId ? this.toIssueLite(bugById.get(e.bugIssueId)) : null,
        testCase: {
          id: e.testCase.id,
          key: e.testCase.key,
          title: e.testCase.title,
          folder: e.testCase.folder,
          precondition: e.testCase.precondition,
          steps: e.testCase.steps,
          expected: e.testCase.expected,
        },
      })),
    };
  }

  async createRun(workspaceId: string, projectId: string, dto: CreateTestRunInput, actingUserId: string) {
    await this.requireProject(workspaceId, projectId);
    const name = dto.name.trim();
    if (!name) throw new BusinessRuleException('Tên đợt chạy bắt buộc');
    const run = await this.prisma.testRun.create({
      data: { projectId, name, description: this.clean(dto.description), createdById: actingUserId },
      select: { id: true },
    });
    if (dto.caseIds?.length) await this.addCases(workspaceId, projectId, run.id, dto.caseIds);
    return this.getRun(workspaceId, projectId, run.id);
  }

  async updateRun(workspaceId: string, projectId: string, runId: string, dto: UpdateTestRunInput) {
    await this.requireProject(workspaceId, projectId);
    const run = await this.requireRun(projectId, runId);
    const data: Prisma.TestRunUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BusinessRuleException('Tên đợt chạy bắt buộc');
      data.name = name;
    }
    if (dto.description !== undefined) data.description = this.clean(dto.description);
    if (dto.finished !== undefined) data.finishedAt = dto.finished ? (run.finishedAt ?? new Date()) : null;
    await this.prisma.testRun.update({ where: { id: runId }, data });
    return this.getRun(workspaceId, projectId, runId);
  }

  async removeRun(workspaceId: string, projectId: string, runId: string) {
    await this.requireProject(workspaceId, projectId);
    await this.requireRun(projectId, runId);
    await this.prisma.testRun.delete({ where: { id: runId } }); // execution cascade
    return { success: true };
  }

  /** Thêm ca kiểm thử vào đợt chạy — mỗi ca sinh 1 lượt chạy trạng thái CHƯA CHẠY. */
  async addCases(workspaceId: string, projectId: string, runId: string, caseIds: string[]) {
    await this.requireProject(workspaceId, projectId);
    await this.requireRun(projectId, runId);
    const unique = [...new Set(caseIds)];
    const valid = await this.prisma.testCase.findMany({
      where: { id: { in: unique }, projectId },
      select: { id: true },
    });
    if (valid.length !== unique.length) throw new NotFoundAppException('Ca kiểm thử không thuộc dự án này');
    const res = await this.prisma.testExecution.createMany({
      data: valid.map((c) => ({ runId, testCaseId: c.id })),
      skipDuplicates: true,
    });
    return { success: true, added: res.count };
  }

  async removeCaseFromRun(workspaceId: string, projectId: string, runId: string, caseId: string) {
    await this.requireProject(workspaceId, projectId);
    await this.requireRun(projectId, runId);
    await this.prisma.testExecution.deleteMany({ where: { runId, testCaseId: caseId } });
    return { success: true };
  }

  /** Ghi kết quả một lượt chạy (upsert theo cặp runId+testCaseId). */
  async setResult(
    workspaceId: string,
    projectId: string,
    runId: string,
    caseId: string,
    dto: SetExecutionInput,
    actingUserId: string,
  ) {
    await this.requireProject(workspaceId, projectId);
    await this.requireRun(projectId, runId);
    await this.requireCase(projectId, caseId);
    const executed = dto.result !== 'UNTESTED';
    await this.prisma.testExecution.upsert({
      where: { runId_testCaseId: { runId, testCaseId: caseId } },
      create: {
        runId, testCaseId: caseId, result: dto.result, note: this.clean(dto.note),
        executedById: executed ? actingUserId : null,
        executedAt: executed ? new Date() : null,
      },
      update: {
        result: dto.result,
        ...(dto.note !== undefined ? { note: this.clean(dto.note) } : {}),
        executedById: executed ? actingUserId : null,
        executedAt: executed ? new Date() : null,
      },
    });
    return this.getRun(workspaceId, projectId, runId);
  }

  /**
   * Tạo issue loại Bug từ một lượt chạy KHÔNG ĐẠT: tiêu đề & mô tả lấy từ ca kiểm thử
   * (tiền điều kiện / các bước / kết quả mong đợi) + ghi chú lượt chạy; lưu `bugIssueId`
   * và gắn luôn bug vào ca kiểm thử để truy vết hai chiều.
   */
  async createBug(
    workspaceId: string,
    projectId: string,
    runId: string,
    caseId: string,
    dto: CreateBugFromExecutionInput,
    actingUserId: string,
  ) {
    await this.requireProject(workspaceId, projectId);
    const run = await this.requireRun(projectId, runId);
    const tc = await this.requireCase(projectId, caseId);
    const exec = await this.prisma.testExecution.findUnique({
      where: { runId_testCaseId: { runId, testCaseId: caseId } },
      select: { id: true, result: true, note: true, bugIssueId: true },
    });
    if (!exec) throw new NotFoundAppException('Lượt chạy kiểm thử');
    if (exec.bugIssueId) throw new BusinessRuleException('Lượt chạy này đã có bug liên kết');
    if (exec.result !== 'FAILED') throw new BusinessRuleException('Chỉ tạo bug cho ca kiểm thử KHÔNG ĐẠT');

    const typeId = await this.resolveBugTypeId(workspaceId);
    const summary = (dto.summary?.trim() || `[${tc.key}] ${tc.title}`).slice(0, 255);
    const description = dto.description?.trim() || this.buildBugDescription(tc, run.name, exec.note);

    const issue = await this.issues.create(workspaceId, actingUserId, {
      projectId,
      typeId,
      summary,
      description,
      descriptionFormat: 'MARKDOWN',
      assigneeId: dto.assigneeId ?? null,
      priorityId: dto.priorityId ?? null,
    });

    await this.prisma.$transaction([
      this.prisma.testExecution.update({ where: { id: exec.id }, data: { bugIssueId: issue.id } }),
      this.prisma.testCaseIssue.createMany({ data: [{ testCaseId: caseId, issueId: issue.id }], skipDuplicates: true }),
    ]);
    return this.getRun(workspaceId, projectId, runId);
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async requireProject(workspaceId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundAppException('Dự án');
  }

  private async requireCase(projectId: string, caseId: string) {
    const c = await this.prisma.testCase.findFirst({ where: { id: caseId, projectId }, select: CASE_SELECT });
    if (!c) throw new NotFoundAppException('Ca kiểm thử');
    return c;
  }

  private async requireRun(projectId: string, runId: string) {
    const r = await this.prisma.testRun.findFirst({
      where: { id: runId, projectId },
      select: { id: true, projectId: true, name: true, description: true, startedAt: true, finishedAt: true },
    });
    if (!r) throw new NotFoundAppException('Đợt chạy kiểm thử');
    return r;
  }

  /** Chủ sở hữu phải là thành viên workspace (chống gán người ngoài tenant). */
  private async resolveOwner(workspaceId: string, ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;
    const m = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: ownerId } },
      select: { id: true },
    });
    if (!m) throw new ForbiddenAppException('Người dùng không thuộc workspace này');
    return ownerId;
  }

  /** Issue liên kết phải thuộc đúng dự án (⇒ đúng workspace). */
  private async validateIssues(projectId: string, issueIds: string[]): Promise<string[]> {
    const unique = [...new Set(issueIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.issue.findMany({
      where: { id: { in: unique }, projectId, deletedAt: null },
      select: { id: true },
    });
    if (rows.length !== unique.length) throw new NotFoundAppException('Issue không thuộc dự án này');
    return unique;
  }

  private async nextCaseKey(projectId: string): Promise<string> {
    const rows = await this.prisma.testCase.findMany({ where: { projectId }, select: { key: true } });
    let max = 0;
    for (const r of rows) {
      const m = /^TC-(\d+)$/.exec(r.key);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `TC-${max + 1}`;
  }

  private async resolveBugTypeId(workspaceId: string): Promise<string> {
    const byKey = await this.prisma.issueType.findFirst({
      where: { workspaceId, key: 'BUG' },
      select: { id: true },
    });
    if (byKey) return byKey.id;
    const byName = await this.prisma.issueType.findFirst({
      where: { workspaceId, name: 'Bug' },
      select: { id: true },
    });
    if (byName) return byName.id;
    const first = await this.prisma.issueType.findFirst({
      where: { workspaceId, isSubtask: false },
      orderBy: { hierarchyLevel: 'asc' },
      select: { id: true },
    });
    if (!first) throw new BusinessRuleException('Workspace chưa cấu hình loại issue nào');
    return first.id;
  }

  private buildBugDescription(
    tc: { key: string; title: string; precondition: string | null; steps: string | null; expected: string | null },
    runName: string,
    note: string | null,
  ): string {
    const parts = [`Phát hiện khi chạy kiểm thử **${tc.key} — ${tc.title}** (đợt chạy: ${runName}).`];
    if (tc.precondition) parts.push(`**Tiền điều kiện**\n\n${tc.precondition}`);
    if (tc.steps) parts.push(`**Các bước tái hiện**\n\n${tc.steps}`);
    if (tc.expected) parts.push(`**Kết quả mong đợi**\n\n${tc.expected}`);
    parts.push(`**Kết quả thực tế**\n\n${note?.trim() || 'Ca kiểm thử không đạt (chưa ghi chú chi tiết).'}`);
    return parts.join('\n\n');
  }

  private emptyProgress(): TestProgress {
    return { total: 0, UNTESTED: 0, PASSED: 0, FAILED: 0, BLOCKED: 0, SKIPPED: 0 };
  }

  private clean(v: string | null | undefined): string | null {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t.length ? t : null;
  }

  private isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  /** "TC-2" đứng trước "TC-10" (sắp xếp theo số, không theo chuỗi). */
  private keyOrder(key: string): number {
    const m = /^TC-(\d+)$/.exec(key);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  }

  private sortByKey<T extends { key: string }>(rows: T[]): T[] {
    return rows.slice().sort((a, b) => this.keyOrder(a.key) - this.keyOrder(b.key));
  }

  private toUserLite(u: UserLiteRow | undefined | null) {
    if (!u) return null;
    return { id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, email: u.email };
  }

  private toIssueLite(i: IssueLiteRow | undefined | null) {
    if (!i) return null;
    return {
      id: i.id,
      key: i.key,
      summary: i.summary,
      statusName: i.status?.name ?? null,
      statusCategory: i.status?.category ?? null,
      typeName: i.type?.name ?? null,
    };
  }

  private toCaseDto(c: CaseRow) {
    return {
      id: c.id,
      projectId: c.projectId,
      key: c.key,
      title: c.title,
      precondition: c.precondition,
      steps: c.steps,
      expected: c.expected,
      folder: c.folder,
      owner: c.owner ? this.toUserLite(c.owner) : null,
      issues: c.issues.map((l) => this.toIssueLite(l.issue)).filter((i) => i !== null),
      issueCount: c.issues.length,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private toRunDto(
    r: { id: string; projectId: string; name: string; description: string | null; startedAt: Date; finishedAt: Date | null },
    progress: TestProgress,
  ) {
    return {
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      description: r.description,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      progress,
    };
  }
}
