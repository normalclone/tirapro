import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { LEGACY_STATUS_MAP } from '@tirapro/shared';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { migrateWorkflowSchemes } from './migrate-workflow-schemes';
import { WorkflowAdminService } from './workflow-admin.service';
import { WorkflowResolver } from './workflow-resolver.service';
import { WorkflowSchemeService } from './workflow-scheme.service';

/**
 * SCRIPT MIGRATE QUY TRÌNH THEO LOẠI VIỆC TRÊN POSTGRES THẬT — OPT-IN (`PARITY_DATABASE_URL=…_scratch pnpm --filter
 * @tirapro/api test:parity`). Hai organization: A (quy trình cũ 9 trạng thái, đủ loại việc, bảng, quy tắc, SLA) và B (đã có quy trình
 * "Bug" tuỳ chỉnh + dòng cấu hình trỏ vào nó — dòng đã có luôn thắng, quy trình tuỳ chỉnh không bị đụng).
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `mg${Date.now().toString(36)}`;
const id = (s: string): string => `${TAG}-${s}`;
const WS_A = id('wa');
const WS_B = id('wb');

const LEGACY = [
  ['Cần làm', 'TODO'],
  ['Đang phân tích', 'TODO'],
  ['Sẵn sàng phát triển', 'TODO'],
  ['Đang làm', 'IN_PROGRESS'],
  ['Review code', 'IN_PROGRESS'],
  ['Chờ test', 'IN_PROGRESS'],
  ['Đang test', 'IN_PROGRESS'],
  ['Hoàn thành', 'DONE'],
  ['Không xử lý', 'DONE'],
] as const;

let prisma: PrismaClient;
const notified: Array<{ recipientId: string; ruleName: string }> = [];

const issues = (ws: string) =>
  prisma.issue.findMany({
    where: { organizationId: ws },
    select: { id: true, statusId: true, version: true, updatedAt: true, resolvedAt: true },
    orderBy: { id: 'asc' },
  });
const systemUser = async (): Promise<string> =>
  (await prisma.user.findUniqueOrThrow({ where: { email: 'automation@tirapro.local' } })).id;
const statusName = async (statusId: string) =>
  (await prisma.status.findUniqueOrThrow({ where: { id: statusId } })).name;

/** Hai tổ chức: bảng, cột, loại việc, quy trình cũ 9 trạng thái (A có thêm cột "ma"). */
async function seedOrganizations(): Promise<void> {
  for (const [ws, slug] of [
    [WS_A, 'a'],
    [WS_B, 'b'],
  ] as const) {
    await prisma.organization.create({
      data: { id: ws, name: `Tổ chức ${slug}`, slug: ws, ownerId: id('u') },
    });
    await prisma.resolution.create({
      data: { id: id(`res-${slug}`), organizationId: ws, name: 'Done', isDefault: true },
    });
    await prisma.workflow.create({
      data: { id: id(`old-${slug}`), organizationId: ws, name: 'Phát triển phần mềm' },
    });
    await prisma.status.createMany({
      data: LEGACY.map(([name, category], i) => ({
        id: id(`old-${slug}-${i}`),
        workflowId: id(`old-${slug}`),
        name,
        category,
        order: i,
        isInitial: i === 0,
      })),
    });
    for (const [k, key] of [
      ['epic', 'EPIC'],
      ['story', 'STORY'],
      ['task', 'TASK'],
      ['bug', 'BUG'],
      ['sub', 'SUBTASK'],
    ] as const)
      await prisma.issueType.create({
        data: { id: id(`t-${k}-${slug}`), organizationId: ws, name: key, key },
      });
    await prisma.issueType.create({
      data: { id: id(`t-cus-${slug}`), organizationId: ws, name: 'Yêu cầu' },
    });
    await prisma.project.create({
      data: {
        id: id(`p-${slug}`),
        organizationId: ws,
        key: slug === 'a' ? 'ATP' : 'GSDA',
        name: slug,
        defaultWorkflowId: id(`old-${slug}`),
      },
    });
    const board = await prisma.board.create({
      data: { id: id(`b-${slug}`), projectId: id(`p-${slug}`), name: 'B', type: 'KANBAN' },
    });
    const cols = [
      ['Cần làm', [0, 1, 2]],
      ['Đang làm', [3, 4, 5, 6]],
      ['Xong', [7, 8]],
    ] as const;
    for (const [i, [name, sts]] of cols.entries()) {
      const c = await prisma.boardColumn.create({
        data: { id: id(`c-${slug}-${i}`), boardId: board.id, name, order: i },
      });
      await prisma.boardColumnStatus.createMany({
        data: sts.map((s) => ({ columnId: c.id, statusId: id(`old-${slug}-${s}`) })),
      });
    }
    if (slug === 'a') {
      // Cột "ma": chỉ chứa một trạng thái CŨ (sau khi chuyển đổi không còn việc nào ở đó) → phải bị xoá, các cột khác đánh số lại.
      const ghost = await prisma.boardColumn.create({
        data: { id: id('c-ghost'), boardId: board.id, name: 'Cột ma', order: 3 },
      });
      await prisma.boardColumnStatus.create({
        data: { columnId: ghost.id, statusId: id('old-a-3') },
      });
    }
  }
}

/** Việc của A (mỗi trạng thái cũ một việc, thùng rác, Bug, Epic) và B (quy trình Bug tuỳ chỉnh). */
async function seedIssues(): Promise<void> {
  let n = 0;
  const issue = (slug: string, typeKey: string, st: number, extra: Record<string, unknown> = {}) =>
    prisma.issue.create({
      data: {
        id: id(`i${n}`),
        key: `${slug}-${n}`,
        number: ++n,
        organizationId: slug === 'a' ? WS_A : WS_B,
        projectId: id(`p-${slug}`),
        typeId: id(`t-${typeKey}-${slug}`),
        statusId: id(`old-${slug}-${st}`),
        summary: `s${n}`,
        rank: `0|${n}:`,
        ...extra,
      },
    });
  // Tổ chức A: mỗi trạng thái cũ một việc Task + Task ở thùng rác + Bug + Epic + một Task đã Done có Resolution.
  for (let st = 0; st < 9; st++)
    await issue(
      'a',
      'task',
      st,
      st === 7 ? { resolvedAt: new Date('2026-01-02'), resolutionId: id('res-a') } : {},
    );
  await issue('a', 'task', 3, { deletedAt: new Date() });
  await issue('a', 'bug', 5);
  await issue('a', 'epic', 3);
  // Tổ chức B: quy trình "Bug" tuỳ chỉnh (To Do / Fixing / Fixed) + dòng cấu hình BUG trỏ vào nó.
  await prisma.workflow.create({ data: { id: id('cbug'), organizationId: WS_B, name: 'Bug' } });
  await prisma.status.createMany({
    data: [
      ['Mới', 'TODO'],
      ['Đang sửa', 'IN_PROGRESS'],
      ['Đã sửa', 'DONE'],
    ].map(([name, category], i) => ({
      id: id(`cbug-${i}`),
      workflowId: id('cbug'),
      name: name!,
      category: category as 'TODO',
      order: i,
      isInitial: i === 0,
    })),
  });
  await prisma.organizationWorkflowScheme.create({
    data: { organizationId: WS_B, issueTypeId: id('t-bug-b'), workflowId: id('cbug') },
  });
  await issue('b', 'bug', 3); // Đang làm → Đang sửa (cùng nhóm)
  await issue('b', 'task', 7); // Hoàn thành → Done
}

/** Quy tắc, bộ lọc/bảng/widget tham chiếu theo tên, mẫu trùng tên và SLA. */
async function seedRulesAndRefs(): Promise<void> {
  // Quy tắc + SLA ở tổ chức A.
  await prisma.automationRule.create({
    data: {
      id: id('rule'),
      organizationId: WS_A,
      name: 'Khi đang làm thì gán',
      trigger: 'ISSUE_TRANSITIONED',
      triggerConfig: { toStatusId: id('old-a-3') },
      conditions: [{ field: 'statusId', op: 'eq', value: id('old-a-3') }],
      actions: [{ type: 'transition', toStatusId: id('old-a-7') }],
      createdById: id('u'),
    },
  });
  // Quy tắc giới hạn loại Task (chỉ Standard): không được rộng sang Bug/Epic. Quy tắc có điều kiện JQL theo tên.
  await prisma.automationRule.create({
    data: {
      id: id('rule-std'),
      organizationId: WS_A,
      name: 'Chỉ Task đang làm',
      trigger: 'ISSUE_TRANSITIONED',
      triggerConfig: { toStatusId: id('old-a-3') },
      conditions: [{ field: 'typeId', op: 'eq', value: id('t-task-a') }],
      actions: [],
      createdById: id('u'),
    },
  });
  await prisma.automationRule.create({
    data: {
      id: id('rule-jql'),
      organizationId: WS_A,
      name: 'Có JQL theo tên',
      trigger: 'ISSUE_CREATED',
      triggerConfig: {},
      conditions: [{ jql: 'status = "Đang test"' }],
      actions: [],
      createdById: id('u'),
    },
  });
  // Tham chiếu theo TÊN trong JQL (chỉ báo): bộ lọc đã lưu, bộ lọc bảng, widget. "Done" vẫn tồn tại nên không bị báo.
  await prisma.savedFilter.createMany({
    data: [
      {
        id: id('f1'),
        organizationId: WS_A,
        ownerId: id('u'),
        name: 'Đang làm của tôi',
        jql: 'status = "Đang làm"',
      },
      {
        id: id('f2'),
        organizationId: WS_A,
        ownerId: id('u'),
        name: 'Đã xong',
        jql: 'status = Done',
      },
    ],
  });
  await prisma.board.update({
    where: { id: id('b-a') },
    data: { filterJql: 'status in ("Chờ test")' },
  });
  await prisma.dashboard.create({
    data: {
      id: id('dash'),
      organizationId: WS_A,
      ownerId: id('u'),
      name: 'Tổng quan',
      widgets: {
        create: [
          {
            id: id('wg'),
            type: 'ISSUE_LIST',
            title: 'Chờ review',
            config: { jql: 'status = "Review code"' },
          },
        ],
      },
    },
  });
  // Mẫu (isTemplate) trùng tên quy trình mặc định ở tổ chức B: không được nhận nhầm làm quy trình mặc định.
  await prisma.workflow.create({
    data: { id: id('tpl'), organizationId: WS_B, name: 'Epic Workflow', isTemplate: true },
  });
  await prisma.slaPolicy.create({
    data: {
      id: id('sla'),
      organizationId: WS_A,
      projectId: id('p-a'),
      name: 'SLA',
      responseMins: 60,
      resolveMins: 600,
    },
  });
}

beforeAll(async () => {
  if (!DB_URL) return;
  prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  await prisma.user.create({
    data: { id: id('u'), email: `${id('u')}@mg.test`, displayName: 'QT' },
  });
  await seedOrganizations();
  await seedIssues();
  await seedRulesAndRefs();
}, 60_000);

afterAll(async () => {
  if (!prisma) return;
  await prisma.project.deleteMany({ where: { organizationId: { in: [WS_A, WS_B] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: TAG } } });
  await prisma.$disconnect();
}, 60_000);

const run = (dryRun: boolean) =>
  migrateWorkflowSchemes(prisma, {
    dryRun,
    organization: undefined,
    notify: (n) => {
      notified.push({ recipientId: n.recipientId, ruleName: n.ruleName });
      return Promise.resolve();
    },
  });
const only = (r: Awaited<ReturnType<typeof run>>, ws: string) =>
  r.organizations.find((w) => w.organizationId === ws)!;

let before: Awaited<ReturnType<typeof issues>>;

describe.skipIf(!DB_URL)('migrateWorkflowSchemes ↔ Postgres thật', () => {
  it('dry-run: in đúng ánh xạ + số liệu và KHÔNG ghi gì', async () => {
    before = await issues(WS_A);
    const out = await run(true);
    const a = only(out, WS_A);
    expect(a.createdWorkflows.sort()).toEqual([
      'Bug Workflow',
      'Epic Workflow',
      'Standard Workflow',
    ]);
    expect(a.createdSchemeRows).toBe(6);
    expect(a.movedIssues).toBe(12); // 10 Task (gồm thùng rác) + Bug + Epic
    const find = (type: string, from: string) =>
      a.moves.find((m) => m.issueTypeName === type && m.fromStatusName === from)!;
    expect(find('TASK', 'Review code')).toMatchObject({ toStatusName: 'In Review', via: 'legacy' });
    expect(find('TASK', 'Đang làm')).toMatchObject({ toStatusName: 'In Progress', count: 2 });
    expect(find('TASK', 'Không xử lý')).toMatchObject({ toStatusName: 'Cancelled' });
    expect(find('BUG', 'Chờ test')).toMatchObject({
      toStatusName: 'Ready for Retest',
      toWorkflowName: 'Bug Workflow',
    });
    expect(find('EPIC', 'Đang làm')).toMatchObject({ toWorkflowName: 'Epic Workflow' });
    expect(a.rules.map((r) => r.ruleId).sort()).toEqual([id('rule'), id('rule-std')].sort());
    // Cột ma (chỉ trạng thái của quy trình lạ, không việc) được liệt kê "sẽ xoá" nhưng CHƯA xoá; bảng không thay đổi.
    expect(a.deletedColumns).toEqual(['ATP / B / Cột ma']);
    expect(a.ghostColumns).toEqual([]);
    expect(await prisma.boardColumn.count({ where: { id: id('c-ghost') } })).toBe(1);
    // Dry-run báo trước → sau của từng quy tắc: quy tắc không giới hạn loại nhận cả 3 quy trình, quy tắc loại Task chỉ Standard.
    const wide = a.rules.find((r) => r.ruleId === id('rule'))!;
    expect(wide.statusRefs![0]).toMatchObject({ fromName: 'Đang làm' });
    expect(wide.statusRefs![0]!.toNames).toEqual(['In Progress', 'In Progress', 'In Progress']);
    const narrow = a.rules.find((r) => r.ruleId === id('rule-std'))!;
    expect(narrow).toMatchObject({ name: 'Chỉ Task đang làm', projectId: null });
    expect(narrow.statusRefs![0]!.toNames).toEqual(['In Progress']);
    expect(a.moves.every((m) => m.fromWorkflowName === 'Phát triển phần mềm')).toBe(true);
    // Tham chiếu theo tên trong JQL sẽ hết khớp (chỉ báo): không báo bộ lọc dùng Done.
    expect(a.nameRefs.map((n) => `${n.kind}:${n.id}`).sort()).toEqual(
      [
        `savedFilter:${id('f1')}`,
        `boardFilter:${id('b-a')}`,
        `widget:${id('wg')}`,
        `rule:${id('rule-jql')}`,
      ].sort(),
    );
    expect(a.nameRefs.find((n) => n.id === id('f1'))!.names).toEqual(['Đang làm']);
    // Tổ chức B: dòng cấu hình của quy trình tuỳ chỉnh thắng → Bug đi vào "Đang sửa" (gợi ý theo nhóm).
    const b = only(out, WS_B);
    expect(b.createdSchemeRows).toBe(5); // BUG đã có dòng
    expect(b.createdWorkflows).toHaveLength(3); // mẫu cùng tên không bị nhận nhầm
    expect(b.moves.find((m) => m.issueTypeName === 'BUG')).toMatchObject({
      toStatusName: 'Đang sửa',
      toWorkflowName: 'Bug',
      via: 'suggested',
    });
    expect(out.totals).toMatchObject({ organizations: 2, movedIssues: 14, rulesRewritten: 2 });
    // Không ghi gì.
    expect(await issues(WS_A)).toEqual(before);
    expect(await prisma.workflow.count({ where: { organizationId: WS_A } })).toBe(1);
    expect(await prisma.organizationWorkflowScheme.count({ where: { organizationId: WS_A } })).toBe(
      0,
    );
    expect(
      (await prisma.automationRule.findUniqueOrThrow({ where: { id: id('rule') } })).triggerConfig,
    ).toEqual({
      toStatusId: id('old-a-3'),
    });
    expect(notified).toHaveLength(0);
  });
});

describe.skipIf(!DB_URL)('migrateWorkflowSchemes ↔ Postgres thật — chạy thật', () => {
  it('chạy thật: chuyển việc (version+1, lịch sử, updatedAt giữ nguyên), bảng, quy tắc; quy trình tuỳ chỉnh và SLA không đụng', async () => {
    const out = await run(false);
    expect(out.totals.movedIssues).toBe(14);
    const after = await issues(WS_A);
    for (const b of before) {
      const a = after.find((x) => x.id === b.id)!;
      expect(a.updatedAt).toEqual(b.updatedAt); // KHÔNG đổi updatedAt
      expect(a.version).toBe(b.version + 1);
      expect(a.statusId).not.toBe(b.statusId);
    }
    const task0 = after.find((x) => x.id === id('i0'))!;
    expect(await statusName(task0.statusId)).toBe('To Do');
    const done = after.find((x) => x.id === id('i7'))!;
    expect(await statusName(done.statusId)).toBe('Done');
    expect(done.resolvedAt).toEqual(new Date('2026-01-02')); // DONE → DONE giữ nguyên resolvedAt
    const hist = await prisma.issueHistory.findMany({
      where: { issueId: id('i3'), field: 'STATUS' },
    });
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      oldValue: 'Đang làm',
      newValue: 'In Progress',
      oldCategory: 'IN_PROGRESS',
      newCategory: 'IN_PROGRESS',
      actorId: await systemUser(), // hệ thống ghi, không phải chủ tổ chức
    });
    // Mọi dòng cấu hình có mặt; ba quy trình mặc định chung của tổ chức.
    expect(await prisma.organizationWorkflowScheme.count({ where: { organizationId: WS_A } })).toBe(
      6,
    );
    const wfNames = (await prisma.workflow.findMany({ where: { organizationId: WS_A } })).map(
      (w) => w.name,
    );
    expect(wfNames.sort()).toEqual([
      'Bug Workflow',
      'Epic Workflow',
      'Phát triển phần mềm',
      'Standard Workflow',
    ]);
    // Không có bước chuyển '*OPEN' thô: mọi bước trỏ vào trạng thái thật.
    const wfStd = await prisma.workflow.findFirstOrThrow({
      where: { organizationId: WS_A, name: 'Standard Workflow' },
      include: { transitions: true, statuses: true },
    });
    expect(wfStd.transitions.length).toBeGreaterThan(8);
    const ids = new Set(wfStd.statuses.map((s) => s.id));
    expect(wfStd.transitions.every((t) => ids.has(t.toStatusId))).toBe(true);
    expect(wfStd.transitions.every((t) => t.fromStatusId === null || ids.has(t.fromStatusId))).toBe(
      true,
    );
    // Quy trình cũ còn nguyên và vẫn là mặc định dự án.
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: id('p-a') } })).defaultWorkflowId,
    ).toBe(id('old-a'));
    expect(await prisma.status.count({ where: { workflowId: id('old-a') } })).toBe(9);
    // Bảng: trạng thái mới nằm trong cột cùng nhóm; trạng thái cũ đã hết việc và không còn thuộc quy trình đang dùng bị gỡ.
    const cols = await prisma.boardColumn.findMany({
      where: { boardId: id('b-a') },
      include: { statuses: { include: { status: true } } },
      orderBy: { order: 'asc' },
    });
    expect(cols[0]!.statuses.map((s) => s.status.name)).toEqual(
      expect.arrayContaining(['To Do', 'Ready', 'New']),
    );
    expect(cols[2]!.statuses.map((s) => s.status.name)).toEqual(
      expect.arrayContaining(['Done', 'Cancelled', 'Closed']),
    );
    const oldIds = new Set(
      (await prisma.status.findMany({ where: { workflowId: id('old-a') } })).map((s) => s.id),
    );
    expect(cols.flatMap((c) => c.statuses).filter((s) => oldIds.has(s.statusId))).toEqual([]);
    expect(out.totals.boardLinksRemoved).toBeGreaterThan(0);
    // Cột ma bị xoá; các cột còn lại được đánh số lại 0..n-1 theo thứ tự cũ; bảng vẫn còn cột.
    expect(only(out, WS_A).deletedColumns).toEqual(['ATP / B / Cột ma']);
    expect(await prisma.boardColumn.count({ where: { id: id('c-ghost') } })).toBe(0);
    expect(cols.map((c) => c.order)).toEqual([0, 1, 2]);
    // Quy tắc: id cũ thành id mới của cả ba quy trình (một id cũ → nhiều đích).
    const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: id('rule') } });
    const trig = rule.triggerConfig as { toStatusId?: string; toStatusIds?: string[] };
    const names = await Promise.all((trig.toStatusIds ?? []).map(statusName));
    expect(names).toEqual(['In Progress', 'In Progress', 'In Progress']);
    expect(new Set(trig.toStatusIds).size).toBe(3);
    expect(trig.toStatusId).toBeUndefined();
    expect(rule.enabled).toBe(true);
    // Quy tắc giới hạn loại Task chỉ nhận trạng thái Standard (không rộng sang Bug/Epic).
    const std = (await prisma.automationRule.findUniqueOrThrow({ where: { id: id('rule-std') } }))
      .triggerConfig as { toStatusId?: string; toStatusIds?: string[] };
    expect(std.toStatusIds).toBeUndefined();
    expect(await statusName(std.toStatusId!)).toBe('In Progress');
    expect(
      (await prisma.status.findUniqueOrThrow({ where: { id: std.toStatusId! } })).workflowId,
    ).toBe(
      (
        await prisma.workflow.findFirstOrThrow({
          where: { organizationId: WS_A, name: 'Standard Workflow' },
        })
      ).id,
    );
    // SLA + tổ chức B: quy trình "Bug" tuỳ chỉnh nguyên vẹn, việc Bug vào "Đang sửa".
    expect(await prisma.slaPolicy.count({ where: { id: id('sla') } })).toBe(1);
    expect(await prisma.status.count({ where: { workflowId: id('cbug') } })).toBe(3);
    const bBug = (await issues(WS_B)).find((x) => x.id === id('i12'))!;
    expect(await statusName(bBug.statusId)).toBe('Đang sửa');
    expect(notified).toHaveLength(0);
  });
});

describe.skipIf(!DB_URL)(
  'migrateWorkflowSchemes ↔ Postgres thật — chạy lại, đổi tên, một tổ chức',
  () => {
    it('chạy lần hai (và dry-run sau đó): 0 thay đổi, version/updatedAt không đổi', async () => {
      const snap = await issues(WS_A);
      const second = await run(false);
      expect(second.totals).toEqual({
        organizations: 2,
        createdWorkflows: 0,
        createdSchemeRows: 0,
        movedIssues: 0,
        boardLinksAdded: 0,
        boardLinksRemoved: 0,
        columnsDeleted: 0,
        rulesRewritten: 0,
        rulesDisabled: 0,
      });
      expect((await run(true)).totals.movedIssues).toBe(0);
      expect(await issues(WS_A)).toEqual(snap);
    });

    it('đổi tên quy trình mặc định rồi chạy lại: không sinh bản trùng (nhận diện bằng dấu ổn định)', async () => {
      await prisma.workflow.updateMany({
        where: { organizationId: WS_A, name: 'Standard Workflow' },
        data: { name: 'Chuẩn của tổ chức' },
      });
      const out = await run(false);
      expect(only(out, WS_A).createdWorkflows).toEqual([]);
      expect(await prisma.workflow.count({ where: { organizationId: WS_A } })).toBe(4);
      await prisma.workflow.updateMany({
        where: { organizationId: WS_A, name: 'Chuẩn của tổ chức' },
        data: { name: 'Standard Workflow' }, // trả lại cho các test sau
      });
    });

    it('chạy cho một tổ chức: chỉ chạm đúng tổ chức đó', async () => {
      const out = await migrateWorkflowSchemes(prisma, { dryRun: true, organization: WS_B });
      expect(out.organizations.map((w) => w.organizationId)).toEqual([WS_B]);
    });
  },
);

// hai đường gọi dùng chung một hàm sửa quy tắc
describe.skipIf(!DB_URL)('rewriteRuleStatusRefs dùng chung cho endpoint (M1)', () => {
  const published: Array<{ recipientId: string; payload: unknown; force?: boolean }> = [];
  const emitted: string[] = [];
  let admin: WorkflowAdminService;
  let svc: WorkflowSchemeService;

  beforeAll(async () => {
    const notifications = {
      publish: (n: { recipientId: string; payload: unknown }, o?: { force?: boolean }) => {
        published.push({ ...n, force: o?.force });
        return Promise.resolve();
      },
    };
    const events = { emit: (e: string) => emitted.push(e) };
    const resolver = new WorkflowResolver();
    svc = new WorkflowSchemeService(
      prisma as unknown as PrismaService,
      resolver,
      { visibleProjectIds: () => Promise.resolve(null) } as never,
      notifications as never,
      events as never,
    );
    admin = new WorkflowAdminService(
      prisma as unknown as PrismaService,
      { visibleWhere: () => Promise.resolve({}) } as never,
      notifications as never,
      events as never,
      resolver,
    );
    // Quy tắc thứ hai (tắt-được) + một loại việc dùng quy trình "Bug" tuỳ chỉnh của B.
    await prisma.automationRule.create({
      data: {
        id: id('rule-b'),
        organizationId: WS_B,
        name: 'Quy tắc sửa xong',
        trigger: 'ISSUE_TRANSITIONED',
        triggerConfig: { toStatusId: id('cbug-2') },
        actions: [],
        createdById: id('u'),
      },
    });
  });

  it('xoá trạng thái KHÔNG có thay thế: quy tắc tham chiếu bị tắt, người tạo được báo, sự kiện bỏ cache phát ra', async () => {
    await admin.removeStatus(WS_B, id('u'), id('cbug-2'));
    const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: id('rule-b') } });
    expect(rule.enabled).toBe(false);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      recipientId: id('u'),
      force: true,
      payload: { automationRuleDisabled: 'Quy tắc sửa xong' },
    });
    expect(emitted).toContain('automation.rules_changed');
  });

  it('PUT scheme: quy tắc của loại đổi quy trình được sửa id qua cùng hàm (dryRun liệt kê, chạy thật ghi)', async () => {
    // Đưa BUG của B về "Bug Workflow" mặc định: quy tắc nhắc "Đang sửa" (trạng thái của quy trình tuỳ chỉnh).
    await prisma.automationRule.create({
      data: {
        id: id('rule-b2'),
        organizationId: WS_B,
        name: 'Khi đang sửa',
        trigger: 'ISSUE_TRANSITIONED',
        triggerConfig: { toStatusId: id('cbug-1') },
        actions: [],
        createdById: id('u'),
      },
    });
    const std = await prisma.workflow.findFirstOrThrow({
      where: { organizationId: WS_B, name: 'Bug Workflow' },
      include: { statuses: true },
    });
    const items = [{ issueTypeId: id('t-bug-b'), workflowId: std.id }];
    const preview = await svc.setOrganizationScheme(WS_B, id('u'), { items }, true);
    expect(preview.affectedRules.map((r) => r.ruleId)).toContain(id('rule-b2'));
    expect(
      (await prisma.automationRule.findUniqueOrThrow({ where: { id: id('rule-b2') } }))
        .triggerConfig,
    ).toEqual({ toStatusId: id('cbug-1') });
    const inProgress = std.statuses.find((s) => s.name === 'In Progress')!.id;
    const statusMap = {
      [id('cbug-0')]: std.statuses.find((s) => s.name === 'New')!.id,
      [id('cbug-1')]: inProgress,
    };
    const real = await svc.setOrganizationScheme(WS_B, id('u'), { items, statusMap }, false);
    expect(real.affectedRules.find((r) => r.ruleId === id('rule-b2'))).toMatchObject({
      outcome: 'rewritten',
    });
    const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: id('rule-b2') } });
    expect(rule.triggerConfig).toEqual({ toStatusId: inProgress });
  });

  it('khoá advisory theo tổ chức: hai thay đổi đồng thời xếp hàng, không lỗi', async () => {
    const std = await prisma.workflow.findFirstOrThrow({
      where: { organizationId: WS_A, name: 'Standard Workflow' },
    });
    const items = [{ issueTypeId: id('t-task-a'), workflowId: std.id }];
    const [r1, r2] = await Promise.all([
      svc.setOrganizationScheme(WS_A, id('u'), { items }, false),
      svc.setOrganizationScheme(WS_A, id('u'), { items }, false),
    ]);
    expect(r1.totalIssues + r2.totalIssues).toBe(0); // đã khớp từ lần chạy script
  });

  it('(L3) không xoá trạng thái ban đầu của quy trình đang được tổ chức dùng: 409 INITIAL_STATUS_IN_USE', async () => {
    const std = await prisma.workflow.findFirstOrThrow({
      where: { organizationId: WS_A, name: 'Standard Workflow' },
      include: { statuses: true },
    });
    const initial = std.statuses.find((s) => s.isInitial)!;
    await expect(admin.removeStatus(WS_A, id('u'), initial.id)).rejects.toMatchObject({
      status: 409,
      code: 'INITIAL_STATUS_IN_USE',
    });
    expect(await prisma.status.count({ where: { id: initial.id } })).toBe(1);
  });
});

describe.skipIf(!DB_URL)('migrateWorkflowSchemes — bảng ánh xạ cũ', () => {
  it('bảng ánh xạ cũ phủ đủ 9 trạng thái cũ (bảo vệ khỏi sửa lệch)', () => {
    expect(Object.keys(LEGACY_STATUS_MAP).sort()).toEqual(LEGACY.map(([n]) => n).sort());
  });
});
