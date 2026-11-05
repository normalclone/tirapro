/* eslint-disable max-lines-per-function -- spec tích hợp: một describe dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { IssuesService } from './issues.service';

/**
 * Đổi loại việc sang Epic TRÊN POSTGRES THẬT (TIRA-BUG-20) — OPT-IN, không chạy trong `pnpm test`. Kiểm: việc đang thuộc Epic/việc cha
 * không đổi sang Epic được trừ khi cùng request gỡ cả hai (422, không ghi gì); đổi được thì việc con trực tiếp thành việc của Epic
 * mới, tổng điểm Epic mới/cũ đúng, lịch sử TYPE/EPIC/PARENT của việc và của việc con.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity issues.type-epic`.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('đổi loại sang Epic ↔ Postgres thật', () => {
  const TAG = `te${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const ORG = id('org');
  const USER = id('user');
  const PROJECT = id('proj');
  let prisma: PrismaClient;
  let svc: IssuesService;
  let taskType: string;
  let epicType: string;
  let subType: string;
  let todo: string;
  let n = 0;

  const mk = async (over: {
    key: string;
    typeId?: string;
    epicId?: string | null;
    parentId?: string | null;
    points?: number | null;
  }) => {
    const i = ++n;
    return prisma.issue.create({
      data: {
        organizationId: ORG,
        projectId: PROJECT,
        number: i,
        key: `${TAG}-${over.key}`.toUpperCase(),
        typeId: over.typeId ?? taskType,
        statusId: todo,
        summary: over.key,
        rank: `r${String(i).padStart(6, '0')}`,
        epicId: over.epicId ?? null,
        parentId: over.parentId ?? null,
        storyPoints: over.points ?? null,
        dueDate: new Date('2026-12-31T00:00:00Z'),
      },
    });
  };
  const row = (iid: string) =>
    prisma.issue.findUniqueOrThrow({
      where: { id: iid },
      select: { typeId: true, epicId: true, parentId: true, storyPoints: true, version: true },
    });
  const history = (iid: string) =>
    prisma.issueHistory
      .findMany({ where: { issueId: iid }, orderBy: { createdAt: 'asc' } })
      .then((r) => r.map((h) => `${h.field}:${h.oldValue ?? ''}>${h.newValue ?? ''}`).sort());

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    await prisma.user.create({
      data: { id: USER, email: `${USER}@te.test`, displayName: 'U', isSystemAdmin: true },
    });
    await prisma.organization.create({ data: { id: ORG, name: TAG, slug: TAG, ownerId: USER } });
    const wf = await prisma.workflow.create({ data: { organizationId: ORG, name: `wf-${TAG}` } });
    todo = (
      await prisma.status.create({
        data: { workflowId: wf.id, name: 'To Do', category: 'TODO', isInitial: true },
      })
    ).id;
    taskType = (
      await prisma.issueType.create({ data: { organizationId: ORG, name: 'Task', key: 'TASK' } })
    ).id;
    epicType = (
      await prisma.issueType.create({
        data: { organizationId: ORG, name: 'Epic', key: 'EPIC', hierarchyLevel: 1 },
      })
    ).id;
    subType = (
      await prisma.issueType.create({
        data: {
          organizationId: ORG,
          name: 'Sub-task',
          key: 'SUBTASK',
          isSubtask: true,
          hierarchyLevel: -1,
        },
      })
    ).id;
    await prisma.project.create({
      data: {
        id: PROJECT,
        organizationId: ORG,
        key: `P${TAG}`.slice(0, 10).toUpperCase(),
        name: TAG,
        defaultWorkflowId: wf.id,
      },
    });
    const db = prisma as unknown as PrismaService;
    const rbac = new RbacService(db, { getClient: () => null, isAvailable: () => false } as never);
    svc = new IssuesService(db, { emit: vi.fn() } as never, rbac);
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.issueHistory.deleteMany({
      where: { projectId: PROJECT },
    });
    await prisma.issue.deleteMany({ where: { organizationId: ORG } });
    await prisma.project.deleteMany({ where: { id: PROJECT } });
    await prisma.workflow.deleteMany({ where: { organizationId: ORG } });
    await prisma.issueType.deleteMany({ where: { organizationId: ORG } });
    await prisma.organization.deleteMany({ where: { id: ORG } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.$disconnect();
  }, 60_000);

  it('đang thuộc Epic / có việc cha mà không gỡ => 422 và không ghi gì', async () => {
    const e = await mk({ key: 'E-A', typeId: epicType });
    const p = await mk({ key: 'P-A' });
    const inEpic = await mk({ key: 'T-A', epicId: e.id });
    const underParent = await mk({ key: 'T-B', parentId: p.id });
    for (const t of [inEpic, underParent])
      await expect(
        svc.update(ORG, USER, t.id, { version: t.version, typeId: epicType }),
      ).rejects.toMatchObject({ status: 422 });
    expect((await row(inEpic.id)).typeId).toBe(taskType);
    expect((await row(underParent.id)).typeId).toBe(taskType);
    expect((await row(inEpic.id)).version).toBe(inEpic.version);
  });

  it('gỡ epicId + parentId cùng request => thành Epic, không còn thuộc ai; lịch sử ghi TYPE/EPIC/PARENT; Epic cũ tính lại điểm', async () => {
    const e = await mk({ key: 'E-B', typeId: epicType, points: 3 });
    const t = await mk({ key: 'T-C', epicId: e.id, points: 3 });
    const out = await svc.update(ORG, USER, t.id, {
      version: t.version,
      typeId: epicType,
      epicId: null,
      parentId: null,
    });
    expect(out.type.name).toBe('Epic');
    expect(out.epicId).toBeNull();
    expect(await row(t.id)).toMatchObject({ typeId: epicType, epicId: null, parentId: null });
    expect(await history(t.id)).toEqual(
      expect.arrayContaining([`TYPE:Task>Epic`, `EPIC:${e.key}>`]),
    );
    expect((await row(e.id)).storyPoints).toBe(0); // Epic cũ mất việc => tổng về 0
  });

  it('việc có việc con thường thành Epic: cần adoptChildren; việc con trực tiếp thành việc của Epic, điểm Epic = tổng việc con, Epic cũ tính lại', async () => {
    const old = await mk({ key: 'E-C', typeId: epicType, points: 5 });
    const t = await mk({ key: 'T-D', epicId: old.id, points: 5 });
    const s1 = await mk({ key: 'S-1', parentId: t.id, epicId: old.id, points: 2 });
    const s2 = await mk({ key: 'S-2', parentId: t.id, points: 3 });
    const grand = await mk({ key: 'G-1', parentId: s1.id, points: 1 });
    const body = { version: t.version, typeId: epicType, epicId: null, parentId: null };
    await expect(svc.update(ORG, USER, t.id, body)).rejects.toMatchObject({
      status: 422,
      code: 'EPIC_ADOPT_CHILDREN_REQUIRED',
    });
    expect((await row(t.id)).typeId).toBe(taskType); // chưa ghi gì
    await svc.update(ORG, USER, t.id, { ...body, adoptChildren: true });
    expect(await row(s1.id)).toMatchObject({ parentId: null, epicId: t.id });
    expect(await row(s2.id)).toMatchObject({ parentId: null, epicId: t.id });
    // việc cháu vẫn dưới việc con của nó
    expect((await row(grand.id)).parentId).toBe(s1.id);
    expect((await row(t.id)).storyPoints).toBe(5);
    expect((await row(old.id)).storyPoints).toBe(0);
    expect(await history(s1.id)).toEqual(
      expect.arrayContaining([`PARENT:${t.key}>`, `EPIC:${old.key}>${t.key}`]),
    );
    expect(await history(s2.id)).toEqual(
      expect.arrayContaining([`PARENT:${t.key}>`, `EPIC:>${t.key}`]),
    );
  });

  it('có việc con sub-task => 422 dù đã gửi adoptChildren; việc con kiểu Epic (dữ liệu cũ) chỉ được gỡ parentId', async () => {
    const withSub = await mk({ key: 'T-E' });
    await mk({ key: 'SUB-1', typeId: subType, parentId: withSub.id });
    await expect(
      svc.update(ORG, USER, withSub.id, {
        version: withSub.version,
        typeId: epicType,
        adoptChildren: true,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('1 việc con (sub-task)') as string,
    });
    expect((await row(withSub.id)).typeId).toBe(taskType);

    const t = await mk({ key: 'T-F' });
    const legacyEpicChild = await mk({ key: 'E-LEG', typeId: epicType, parentId: t.id });
    await svc.update(ORG, USER, t.id, {
      version: t.version,
      typeId: epicType,
      adoptChildren: true,
    });
    expect(await row(legacyEpicChild.id)).toMatchObject({ parentId: null, epicId: null });
  });

  it('Epic còn việc con không đổi sang loại thường được; Epic vừa chuyển (không có việc con) thì Hoàn tác được', async () => {
    const e = await mk({ key: 'E-D', typeId: epicType });
    await mk({ key: 'T-G', epicId: e.id });
    await expect(
      svc.update(ORG, USER, e.id, { version: e.version, typeId: taskType }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Epic đang có 1 việc con') as string,
    });
    expect((await row(e.id)).typeId).toBe(epicType);

    const parentEpic = await mk({ key: 'E-E', typeId: epicType });
    const t = await mk({ key: 'T-H', epicId: parentEpic.id });
    const up = await svc.update(ORG, USER, t.id, {
      version: t.version,
      typeId: epicType,
      epicId: null,
      parentId: null,
    });
    await svc.update(ORG, USER, t.id, {
      version: up.version,
      typeId: taskType,
      epicId: parentEpic.id,
      parentId: null,
    });
    expect(await row(t.id)).toMatchObject({ typeId: taskType, epicId: parentEpic.id });
  });
});
