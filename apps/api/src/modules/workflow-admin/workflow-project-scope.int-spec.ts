import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { WorkflowResolver } from './workflow-resolver.service';
import { WorkflowSchemeService } from './workflow-scheme.service';

/**
 * ĐỔI QUY TRÌNH Ở CẤP DỰ ÁN KHÔNG LẤN SANG DỰ ÁN KHÁC — trên Postgres thật, OPT-IN (`PARITY_DATABASE_URL=…_scratch`
 * `pnpm --filter @tirapro/api test:parity`). Người gọi là Quản trị dự án A (chỉ thấy dự án A): xem trước và chạy thật chỉ sửa quy
 * tắc CỦA dự án A, quy tắc áp toàn tổ chức chỉ được BÁO "cần xem lại", và danh sách tham chiếu theo tên không lộ bộ lọc riêng tư
 * của người khác, bảng/bảng tổng quan/quy tắc của dự án riêng tư B.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `ps${Date.now().toString(36)}`;
const id = (s: string): string => `${TAG}-${s}`;
const WS = id('ws');

let prisma: PrismaClient;
let svc: WorkflowSchemeService;

/** Tổ chức, hai quy trình, loại việc, hai dự án (B riêng tư) mỗi dự án một bảng và một việc ở "Đang làm". */
async function seedBase(): Promise<void> {
  for (const u of ['u', 'o'])
    await prisma.user.create({ data: { id: id(u), email: `${id(u)}@ps.test`, displayName: u } });
  await prisma.workspace.create({ data: { id: WS, name: WS, slug: WS, ownerId: id('o') } });
  await prisma.resolution.create({
    data: { id: id('res'), workspaceId: WS, name: 'Done', isDefault: true },
  });
  for (const [wf, name, names] of [
    ['old', 'Cũ', ['Cần làm', 'Đang làm', 'Xong']],
    ['std', 'Standard', ['To Do', 'In Progress', 'Done']],
  ] as const) {
    await prisma.workflow.create({ data: { id: id(wf), workspaceId: WS, name } });
    await prisma.status.createMany({
      data: names.map((n, i) => ({
        id: id(`${wf}-${i}`),
        workflowId: id(wf),
        name: n,
        category: (['TODO', 'IN_PROGRESS', 'DONE'] as const)[i]!,
        order: i,
        isInitial: i === 0,
      })),
    });
  }
  await prisma.issueType.create({
    data: { id: id('t'), workspaceId: WS, name: 'Task', key: 'TASK' },
  });
  await prisma.workspaceWorkflowScheme.create({
    data: { workspaceId: WS, issueTypeId: id('t'), workflowId: id('old') },
  });
  for (const [p, key, priv] of [
    ['pa', 'PSA', false],
    ['pb', 'PSB', true],
  ] as const) {
    await prisma.project.create({
      data: {
        id: id(p),
        workspaceId: WS,
        key,
        name: key,
        isPrivate: priv,
        defaultWorkflowId: id('old'),
      },
    });
    await prisma.board.create({
      data: {
        id: id(`b-${p}`),
        projectId: id(p),
        name: `Bảng ${key}`,
        type: 'KANBAN',
        filterJql: 'status = "Đang làm"',
      },
    });
    await prisma.issue.create({
      data: {
        id: id(`i-${p}`),
        key: `${key}-1`,
        number: 1,
        workspaceId: WS,
        projectId: id(p),
        typeId: id('t'),
        statusId: id('old-1'),
        summary: 'x',
        rank: '0|a:',
      },
    });
  }
}

/** Quy tắc, bộ lọc đã lưu, chia sẻ và bảng tổng quan cùng nhắc trạng thái cũ (một số thuộc dự án B riêng tư). */
async function seedRefs(): Promise<void> {
  // Quy tắc: của A, của B (riêng tư), và áp toàn tổ chức — cùng nhắc trạng thái cũ "Đang làm".
  for (const [r, projectId] of [
    ['ra', id('pa')],
    ['rb', id('pb')],
    ['rws', null],
  ] as const)
    await prisma.automationRule.create({
      data: {
        id: id(r),
        workspaceId: WS,
        projectId,
        name: `Quy tắc ${r}`,
        trigger: 'ISSUE_TRANSITIONED',
        triggerConfig: { toStatusId: id('old-1') },
        conditions: [{ jql: 'status = "Đang làm"' }],
        actions: [],
        createdById: id('o'),
      },
    });
  // Bộ lọc đã lưu: của mình, riêng tư của người khác, chia sẻ cả tổ chức.
  await prisma.savedFilter.createMany({
    data: [
      {
        id: id('f-own'),
        workspaceId: WS,
        ownerId: id('u'),
        name: 'Của tôi',
        jql: 'status = "Đang làm"',
      },
      {
        id: id('f-other'),
        workspaceId: WS,
        ownerId: id('o'),
        name: 'Riêng của người khác',
        jql: 'status = "Đang làm"',
      },
      {
        id: id('f-shared'),
        workspaceId: WS,
        ownerId: id('o'),
        name: 'Chia sẻ cả tổ chức',
        jql: 'status = "Đang làm"',
        visibility: 'SHARED',
      },
    ],
  });
  // Chia sẻ cho dự án A (người xem là Quản trị dự án A, thấy A): chỉ chia sẻ cho dự án người xem thấy mới hiện trong báo cáo.
  await prisma.savedFilterProjectShare.create({
    data: { filterId: id('f-shared'), projectId: id('pa') },
  });
  // Bảng tổng quan riêng tư của dự án B.
  await prisma.dashboard.create({
    data: {
      id: id('dash'),
      workspaceId: WS,
      ownerId: id('o'),
      projectId: id('pb'),
      name: 'Tổng quan B',
      scope: 'PROJECT',
      widgets: {
        create: [
          {
            id: id('wg'),
            type: 'ISSUE_LIST',
            title: 'W',
            config: { jql: 'status = "Đang làm"' },
          },
        ],
      },
    },
  });
}

beforeAll(async () => {
  if (!DB_URL) return;
  prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  // Quản trị dự án A chỉ thấy dự án A (dự án B riêng tư).
  const access = { visibleProjectIds: () => Promise.resolve([id('pa')]) };
  svc = new WorkflowSchemeService(
    prisma as unknown as PrismaService,
    new WorkflowResolver(),
    access as never,
  );
  await seedBase();
  await seedRefs();
}, 60_000);

afterAll(async () => {
  if (!prisma) return;
  await prisma.project.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspace.deleteMany({ where: { id: WS } });
  await prisma.user.deleteMany({ where: { id: { startsWith: TAG } } });
  await prisma.$disconnect();
}, 60_000);

const body = () => ({
  issueTypeId: id('t'),
  workflowId: id('std'),
  statusMap: {
    [id('old-0')]: id('std-0'),
    [id('old-1')]: id('std-1'),
    [id('old-2')]: id('std-2'),
  },
});
const ruleTrigger = async (r: string) =>
  (await prisma.automationRule.findUniqueOrThrow({ where: { id: id(r) } })).triggerConfig;

describe.skipIf(!DB_URL)('đổi quy trình của MỘT dự án ↔ Postgres thật', () => {
  it('xem trước: chỉ quy tắc của dự án A được sửa; quy tắc toàn tổ chức chỉ "cần xem lại"; quy tắc dự án B không lộ', async () => {
    const out = await svc.setProjectOverride(WS, id('pa'), id('u'), body(), true);
    const byId = Object.fromEntries(out.affectedRules.map((r) => [r.ruleId, r.outcome]));
    expect(byId).toEqual({ [id('ra')]: 'rewritten', [id('rws')]: 'needsReview' });
    // Không ghi gì.
    expect(await ruleTrigger('ra')).toEqual({ toStatusId: id('old-1') });
  });

  it('tham chiếu theo tên chỉ gồm thứ người gọi thấy: bộ lọc của mình/chia sẻ, bảng và quy tắc của dự án A', async () => {
    const out = await svc.setProjectOverride(WS, id('pa'), id('u'), body(), true);
    const refs = out.nameRefs.map((n) => `${n.kind}:${n.id}`).sort();
    expect(refs).toEqual(
      [
        `savedFilter:${id('f-own')}`,
        `savedFilter:${id('f-shared')}`,
        `boardFilter:${id('b-pa')}`,
        `rule:${id('ra')}`,
      ].sort(),
    );
    const text = JSON.stringify(out);
    for (const secret of [
      id('f-other'),
      id('b-pb'),
      id('wg'),
      id('rb'),
      'PSB',
      'Tổng quan B',
      'Riêng của người khác',
    ])
      expect(text).not.toContain(secret);
  });

  it('chạy thật: chỉ dự án A đổi; quy tắc của A sửa, quy tắc B và toàn tổ chức KHÔNG bị sửa/tắt; việc của B không bị chuyển', async () => {
    const out = await svc.setProjectOverride(WS, id('pa'), id('u'), body(), false);
    expect(out.totalIssues).toBe(1);
    // Trạng thái cũ còn việc (của dự án B) nên quy tắc giữ cả id cũ lẫn id mới.
    expect(await ruleTrigger('ra')).toEqual({ toStatusIds: [id('std-1'), id('old-1')] });
    expect(await ruleTrigger('rb')).toEqual({ toStatusId: id('old-1') });
    expect(await ruleTrigger('rws')).toEqual({ toStatusId: id('old-1') });
    const enabled = await prisma.automationRule.findMany({
      where: { workspaceId: WS },
      select: { id: true, enabled: true },
    });
    expect(enabled.every((r) => r.enabled)).toBe(true);
    const issues = await prisma.issue.findMany({
      where: { workspaceId: WS },
      select: { id: true, statusId: true },
    });
    expect(issues.find((i) => i.id === id('i-pa'))!.statusId).toBe(id('std-1'));
    expect(issues.find((i) => i.id === id('i-pb'))!.statusId).toBe(id('old-1'));
  });
});
