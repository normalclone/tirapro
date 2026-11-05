/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { MembersService } from '../members/members.service';
import { ProjectTeamsService } from '../project-teams/project-teams.service';
import { RbacService } from '../rbac/rbac.service';
import { SearchService } from '../search/search.service';
import { ProjectSubTeamsService } from './project-subteams.service';
import {
  pruneSubTeamsForPrivateProject,
  pruneSubTeamsOnMembershipRemoved,
} from './subteam-membership';

/**
 * Team riêng trong dự án TRÊN POSTGRES THẬT — OPT-IN, không chạy trong `pnpm test`. Kiểm: CRUD + bất biến "thành viên team ⊆ thành viên dự án"
 * (cả dự án công khai lẫn riêng tư, người rời dự án/tổ chức ra khỏi team), JQL `team` (so tên TRONG dự án của việc, `=`/`!=`/`IN`/`NOT IN`/
 * `IS [NOT] EMPTY`, lỗi giá trị lạ + gợi ý), báo cáo theo team (đếm + điểm việc lá, lọc theo team).
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity project-subteams`.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('team riêng trong dự án ↔ Postgres thật', () => {
  const TAG = `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const ORG = id('org');
  const ADMIN = id('admin');
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => id(`u${n}`)) as [
    string,
    string,
    string,
    string,
  ];
  const OUTSIDER = id('out'); // không thuộc tổ chức
  const ROLE = id('prole');
  let prisma: PrismaClient;
  let svc: ProjectSubTeamsService;
  let search: SearchService;
  let analytics: AnalyticsService;
  let members: MembersService;
  let pteams: ProjectTeamsService;
  let seq = 0;
  let typeId: string;
  let todoId: string;
  let doneId: string;

  const newProject = async (
    isPrivate = false,
    key = `P${++seq}${TAG}`.slice(0, 10).toUpperCase(),
  ) => {
    const pid = id(`proj${++seq}`);
    await prisma.project.create({
      data: { id: pid, organizationId: ORG, key, name: pid, isPrivate },
    });
    return { pid, key };
  };
  const addMember = (projectId: string, userId: string) =>
    prisma.projectMembership.create({
      data: { projectId, userId, roleId: ROLE, roles: { create: [{ roleId: ROLE }] } },
    });
  let issueNo = 0;
  const issue = async (
    projectId: string,
    over: {
      assigneeId?: string | null;
      points?: number | null;
      done?: boolean;
      parentId?: string;
      due?: Date;
      key?: string;
    } = {},
  ) => {
    const n = ++issueNo;
    return prisma.issue.create({
      data: {
        organizationId: ORG,
        projectId,
        number: n,
        key: over.key ?? `${TAG}-I${n}`.toUpperCase(),
        typeId,
        statusId: over.done ? doneId : todoId,
        summary: `issue ${n}`,
        rank: `r${String(n).padStart(6, '0')}`,
        assigneeId: over.assigneeId ?? null,
        storyPoints: over.points ?? null,
        parentId: over.parentId ?? null,
        dueDate: over.due ?? null,
      },
    });
  };
  const keysFor = async (jql: string, projectId?: string) => {
    // đếm theo từng việc của TAG để biết CHÍNH XÁC việc nào khớp (count() chỉ trả số)
    const keys = (
      await prisma.issue.findMany({
        where: { organizationId: ORG, ...(projectId ? { projectId } : {}) },
        select: { key: true },
      })
    ).map((i) => i.key);
    const hit: string[] = [];
    for (const k of keys)
      if ((await search.count(ORG, a, `key = "${k}" AND (${jql})`)) === 1) hit.push(k);
    return hit.sort();
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    for (const uid of [ADMIN, a, b, c, d, OUTSIDER])
      await prisma.user.create({
        data: {
          id: uid,
          email: `${uid}@st.test`,
          displayName: `Người ${uid.slice(-2)}`,
          isSystemAdmin: uid === ADMIN,
        },
      });
    await prisma.organization.create({ data: { id: ORG, name: TAG, slug: TAG, ownerId: ADMIN } });
    await prisma.role.create({
      data: { id: ROLE, organizationId: ORG, name: ROLE, scope: 'PROJECT' },
    });
    await prisma.role.create({
      data: { id: id('orgrole'), organizationId: ORG, name: id('orgrole'), scope: 'ORGANIZATION' },
    });
    for (const uid of [ADMIN, a, b, c, d])
      await prisma.organizationMembership.create({
        data: { organizationId: ORG, userId: uid, roleId: id('orgrole') },
      });
    typeId = (
      await prisma.issueType.create({
        data: { organizationId: ORG, name: `Task-${TAG}`, key: 'TASK' },
      })
    ).id;
    const wf = await prisma.workflow.create({ data: { organizationId: ORG, name: `wf-${TAG}` } });
    todoId = (
      await prisma.status.create({
        data: { workflowId: wf.id, name: 'To Do', category: 'TODO', isInitial: true },
      })
    ).id;
    doneId = (
      await prisma.status.create({
        data: { workflowId: wf.id, name: 'Done', category: 'DONE', order: 1 },
      })
    ).id;

    const db = prisma as unknown as PrismaService;
    const rbac = new RbacService(db, { getClient: () => null, isAvailable: () => false } as never);
    const audit = new AuditService(db);
    svc = new ProjectSubTeamsService(db, audit);
    members = new MembersService(
      db,
      rbac,
      { revokeAllForUser: vi.fn(() => Promise.resolve([])), dropCaches: vi.fn() } as never,
      { emit: vi.fn() } as never,
      audit,
    );
    pteams = new ProjectTeamsService(db, rbac, { emit: vi.fn() } as never, audit);
    const access = {
      visibleWhere: () => Promise.resolve({}),
      visibleProjectIds: () => Promise.resolve(null),
    };
    search = new SearchService({} as never, db, access as never);
    analytics = new AnalyticsService(
      db,
      { forProjects: () => Promise.resolve(new Map()) } as never,
      access as never,
    );
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const like = { startsWith: TAG };
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG } });
    await prisma.issue.deleteMany({ where: { organizationId: ORG } });
    await prisma.project.deleteMany({ where: { id: like } });
    await prisma.team.deleteMany({ where: { id: like } });
    await prisma.workflow.deleteMany({ where: { organizationId: ORG } });
    await prisma.issueType.deleteMany({ where: { organizationId: ORG } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: ORG } });
    await prisma.role.deleteMany({ where: { id: like } });
    await prisma.organization.deleteMany({ where: { id: like } });
    await prisma.user.deleteMany({ where: { id: like } });
    await prisma.$disconnect();
  }, 60_000);

  // ───────────────────────── CRUD + bất biến thành viên ─────────────────────────

  it('CRUD: tạo kèm người, một người ở nhiều team, tên duy nhất không phân biệt hoa/thường, đổi người, xoá', async () => {
    const { pid } = await newProject();
    const qa = await svc.create(ORG, pid, { name: 'QA', memberIds: [a, b] }, ADMIN);
    expect(qa.members.map((m) => m.id).sort()).toEqual([a, b]);
    expect(qa.memberCount).toBe(2);
    const dev = await svc.create(
      ORG,
      pid,
      { name: 'Dev', color: '#00f', memberIds: [b, c] },
      ADMIN,
    );
    expect(dev.color).toBe('#00f');
    expect((await svc.list(ORG, pid)).map((t) => t.name)).toEqual(['Dev', 'QA']); // theo tên
    await expect(svc.create(ORG, pid, { name: ' qa ' }, ADMIN)).rejects.toMatchObject({
      status: 422,
    });
    const renamed = await svc.update(ORG, pid, qa.id, { name: 'Kiểm thử' }, ADMIN);
    expect(renamed.name).toBe('Kiểm thử');
    await expect(svc.update(ORG, pid, dev.id, { name: 'kiểm thử' }, ADMIN)).rejects.toMatchObject({
      status: 422,
    });
    await svc.update(ORG, pid, dev.id, { name: 'DEV' }, ADMIN); // đổi hoa/thường của chính mình được
    const swapped = await svc.setMembers(ORG, pid, qa.id, [c, d], ADMIN);
    expect(swapped.members.map((m) => m.id).sort()).toEqual([c, d]);
    await svc.remove(ORG, pid, qa.id, ADMIN);
    expect(await prisma.projectSubTeamMember.count({ where: { subTeamId: qa.id } })).toBe(0);
    await expect(svc.remove(ORG, pid, qa.id, ADMIN)).rejects.toMatchObject({ status: 404 });
    // team của dự án khác không đụng được qua dự án này
    const other = await newProject();
    await expect(svc.update(ORG, other.pid, dev.id, { name: 'x' }, ADMIN)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('thành viên phải là thành viên dự án: người ngoài tổ chức bị từ chối; dự án riêng tư chỉ nhận người có ProjectMembership', async () => {
    const pub = await newProject();
    await expect(
      svc.create(ORG, pub.pid, { name: 'X', memberIds: [OUTSIDER] }, ADMIN),
    ).rejects.toMatchObject({ status: 422 });
    const priv = await newProject(true);
    await addMember(priv.pid, a);
    await expect(
      svc.create(ORG, priv.pid, { name: 'X', memberIds: [a, b] }, ADMIN),
    ).rejects.toMatchObject({ status: 422 });
    const ok = await svc.create(ORG, priv.pid, { name: 'X', memberIds: [a] }, ADMIN);
    await expect(svc.setMembers(ORG, priv.pid, ok.id, [a, b], ADMIN)).rejects.toMatchObject({
      status: 422,
    });
    expect((await svc.list(ORG, priv.pid))[0]!.memberCount).toBe(1); // lần thất bại không đổi gì
    // dự án lưu trữ là chỉ đọc
    await prisma.project.update({ where: { id: pub.pid }, data: { archivedAt: new Date() } });
    await expect(svc.create(ORG, pub.pid, { name: 'Y' }, ADMIN)).rejects.toMatchObject({
      status: 422,
    });
    expect(await svc.list(ORG, pub.pid)).toEqual([]);
  });

  it('người rời dự án riêng tư ra khỏi team (xoá vai trò riêng, gỡ team, gỡ khỏi tổ chức); dự án công khai giữ nguyên', async () => {
    const priv = await newProject(true);
    for (const u of [a, b, c]) await addMember(priv.pid, u);
    const t = await svc.create(ORG, priv.pid, { name: 'T', memberIds: [a, b, c] }, ADMIN);
    const idsOf = async () => (await svc.list(ORG, priv.pid))[0]!.members.map((m) => m.id).sort();
    // 1. xoá vai trò riêng (gỡ khỏi dự án riêng tư)
    await members.clearProjectOverride(ORG, priv.pid, a, ADMIN);
    expect(await idsOf()).toEqual([b, c]);
    // 2. gỡ team là nguồn duy nhất vai trò của b (cần còn người khác ở dự án)
    const tid = id(`tm${++seq}`);
    await prisma.team.create({ data: { id: tid, organizationId: ORG, name: tid, key: tid } });
    await prisma.projectMembership.delete({
      where: { projectId_userId: { projectId: priv.pid, userId: b } },
    });
    await prisma.projectSubTeamMember.deleteMany({ where: { subTeamId: t.id, userId: b } });
    await prisma.teamMember.create({ data: { teamId: tid, userId: b } });
    await pteams.link(ORG, priv.pid, tid, [ROLE], ADMIN);
    await svc.setMembers(ORG, priv.pid, t.id, [b, c], ADMIN);
    expect(await idsOf()).toEqual([b, c]);
    await pteams.unlink(ORG, priv.pid, tid, ADMIN); // b chỉ nhờ team → rời dự án → rời team riêng
    expect(await idsOf()).toEqual([c]);
    // 3. gỡ khỏi tổ chức
    await addMember(priv.pid, d);
    await svc.setMembers(ORG, priv.pid, t.id, [c, d], ADMIN);
    await members.removeOrganization(ORG, d, ADMIN);
    expect(await idsOf()).toEqual([c]);
    expect(await prisma.projectSubTeamMember.count({ where: { userId: d } })).toBe(0);
    // dự án công khai: bỏ ProjectMembership không đổi tư cách (vẫn là thành viên tổ chức)
    const pub = await newProject();
    await addMember(pub.pid, a);
    const pt = await svc.create(ORG, pub.pid, { name: 'P', memberIds: [a, b] }, ADMIN);
    await members.clearProjectOverride(ORG, pub.pid, a, ADMIN);
    expect((await svc.list(ORG, pub.pid)).find((x) => x.id === pt.id)!.memberCount).toBe(2);
  });

  it('dự án chuyển sang riêng tư: ai không có ProjectMembership ra khỏi team riêng', async () => {
    const p = await newProject();
    await addMember(p.pid, a);
    const t = await svc.create(ORG, p.pid, { name: 'T', memberIds: [a, b, c] }, ADMIN);
    await prisma.project.update({ where: { id: p.pid }, data: { isPrivate: true } });
    await prisma.$transaction((tx) => pruneSubTeamsForPrivateProject(tx, p.pid));
    expect(
      (await svc.list(ORG, p.pid)).find((x) => x.id === t.id)!.members.map((m) => m.id),
    ).toEqual([a]);
  });

  it('thành viên team bị vô hiệu hoá sau đó vẫn ở lại và không chặn các lần lưu khác; thêm MỚI người bị khoá thì bị từ chối', async () => {
    const { pid } = await newProject();
    const t = await svc.create(ORG, pid, { name: 'Khoá', memberIds: [a, b] }, ADMIN);
    await prisma.user.update({ where: { id: b }, data: { status: 'DEACTIVATED' } });
    try {
      // đổi màu / tên (giao diện luôn gửi kèm memberIds hiện có) vẫn lưu được, người bị khoá giữ nguyên
      const saved = await svc.update(ORG, pid, t.id, { color: '#f00', memberIds: [a, b] }, ADMIN);
      expect(saved.color).toBe('#f00');
      expect(saved.members.map((m) => m.id).sort()).toEqual([a, b]);
      // thêm người khác trong khi b vẫn bị khoá
      const added = await svc.setMembers(ORG, pid, t.id, [a, b, c], ADMIN);
      expect(added.members.map((m) => m.id).sort()).toEqual([a, b, c]);
      // thêm MỚI một người bị khoá → 422; DB không đổi
      await prisma.user.update({ where: { id: d }, data: { status: 'DEACTIVATED' } });
      await expect(svc.setMembers(ORG, pid, t.id, [a, b, c, d], ADMIN)).rejects.toMatchObject({
        status: 422,
      });
      expect((await svc.list(ORG, pid))[0]!.members.map((m) => m.id).sort()).toEqual([a, b, c]);
      // bỏ người bị khoá được
      const removed = await svc.setMembers(ORG, pid, t.id, [a, c], ADMIN);
      expect(removed.members.map((m) => m.id).sort()).toEqual([a, c]);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: [b, d] } }, data: { status: 'ACTIVE' } });
    }
  });

  it('tên chứa "_" / "%" không bị coi là ký tự đại diện khi kiểm trùng; vẫn trùng khi chỉ khác hoa/thường', async () => {
    const { pid } = await newProject();
    await svc.create(ORG, pid, { name: 'QA-Backend' }, ADMIN);
    await svc.create(ORG, pid, { name: 'QA_Backend' }, ADMIN); // trước đây bị từ chối nhầm ('_' khớp '-')
    await svc.create(ORG, pid, { name: '%' }, ADMIN); // trước đây trùng mọi team
    await expect(svc.create(ORG, pid, { name: 'qa_backend' }, ADMIN)).rejects.toMatchObject({
      status: 422,
    });
    await expect(svc.create(ORG, pid, { name: '%' }, ADMIN)).rejects.toMatchObject({ status: 422 });
    expect((await svc.list(ORG, pid)).map((t) => t.name).sort()).toEqual([
      '%',
      'QA-Backend',
      'QA_Backend',
    ]);
  });

  it('đua: thêm người vào team ↔ người đó bị gỡ khỏi dự án riêng tư không để lại thành viên team không còn trong dự án', async () => {
    const { pid } = await newProject(true);
    await addMember(pid, a);
    await addMember(pid, b);
    const t = await svc.create(ORG, pid, { name: 'Race', memberIds: [a] }, ADMIN);
    // 1. Giữ khoá hàng User(b): lần chèn b vào team (kiểm khoá ngoại) sẽ đứng chờ GIỮA chừng, sau khi đã đọc tư cách thành viên.
    let releaseUser: () => void = () => undefined;
    const held = new Promise<void>((r) => (releaseUser = r));
    let locked: () => void = () => undefined;
    const gotLock = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${b} FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 30_000 },
    );
    await gotLock;
    // 2. Thêm b: đã giữ khoá team riêng + đọc thấy b còn là thành viên, rồi kẹt ở lúc chèn.
    const add = svc.setMembers(ORG, pid, t.id, [a, b], ADMIN);
    await new Promise((r) => setTimeout(r, 400));
    // 3. Gỡ b khỏi dự án: xoá ProjectMembership rồi prune. Phải CHỜ khoá của lần thêm (không được chạy chen trước).
    let removed = false;
    const removal = prisma
      .$transaction(
        async (tx) => {
          await tx.projectMembership.delete({
            where: { projectId_userId: { projectId: pid, userId: b } },
          });
          await pruneSubTeamsOnMembershipRemoved(tx, pid, b);
        },
        { timeout: 30_000 },
      )
      .then(() => (removed = true));
    await new Promise((r) => setTimeout(r, 400));
    expect(removed).toBe(false); // đang chờ khoá, chưa commit
    releaseUser();
    await holder;
    await add;
    await removal;
    expect(await prisma.projectMembership.count({ where: { projectId: pid, userId: b } })).toBe(0);
    expect(await prisma.projectSubTeamMember.count({ where: { subTeamId: t.id, userId: b } })).toBe(
      0,
    );
  }, 30_000);

  // ───────────────────────── JQL `team` ─────────────────────────

  it('JQL team: so tên TRONG dự án của việc; =, !=, IN, NOT IN, IS [NOT] EMPTY; việc chưa gán ở phủ định', async () => {
    const p1 = await newProject();
    const p2 = await newProject();
    await svc.create(ORG, p1.pid, { name: 'QA', memberIds: [a] }, ADMIN);
    await svc.create(ORG, p1.pid, { name: 'Dev', memberIds: [b] }, ADMIN);
    await svc.create(ORG, p2.pid, { name: 'qa', memberIds: [b] }, ADMIN); // cùng tên, người khác, dự án khác
    const i1a = await issue(p1.pid, { assigneeId: a }); // QA p1
    const i1b = await issue(p1.pid, { assigneeId: b }); // Dev p1
    const i1c = await issue(p1.pid, { assigneeId: c }); // không team
    const i1n = await issue(p1.pid); // chưa gán
    const i2a = await issue(p2.pid, { assigneeId: a }); // a không thuộc team nào của p2
    const i2b = await issue(p2.pid, { assigneeId: b }); // qa p2
    const k = (...is: Array<{ key: string }>) => is.map((i) => i.key).sort();
    const only = async (jql: string) =>
      (await keysFor(jql)).filter((x) => [i1a, i1b, i1c, i1n, i2a, i2b].some((i) => i.key === x));
    expect(await only('team = "QA"')).toEqual(k(i1a, i2b)); // không phân biệt hoa/thường; mỗi việc theo team của CHÍNH dự án nó
    expect(await only('team = "Dev"')).toEqual(k(i1b));
    expect(await only('team IN ("QA", "Dev")')).toEqual(k(i1a, i1b, i2b));
    expect(await only('team != "QA"')).toEqual(k(i1b, i1c, i1n, i2a));
    expect(await only('team NOT IN ("QA", "Dev")')).toEqual(k(i1c, i1n, i2a));
    expect(await only('team IS EMPTY')).toEqual(k(i1c, i1n, i2a));
    expect(await only('team IS NOT EMPTY')).toEqual(k(i1a, i1b, i2b));
    expect(await only('project = "' + p1.key + '" AND team = "QA"')).toEqual(k(i1a));
    await expect(search.count(ORG, a, 'team ~ "QA"')).rejects.toMatchObject({ status: 422 }); // toán tử không hỗ trợ
  });

  it('JQL team: giá trị lạ → lỗi 422 như các trường khác (kèm "ý bạn là"); validate trả gợi ý; danh mục gợi ý giá trị', async () => {
    const p = await newProject();
    await svc.create(ORG, p.pid, { name: `Kiểm thử ${TAG}`, memberIds: [a] }, ADMIN);
    await expect(search.count(ORG, a, `team = "Kiem thu ${TAG}x"`)).rejects.toMatchObject({
      status: 422,
    });
    const v = await search.validate(ORG, a, `team = "kiểm thử ${TAG}"`); // khác hoa/thường: hợp lệ
    expect(v.valid).toBe(true);
    const bad = await search.validate(ORG, a, `team = "Kiểm thử ${TAG}z"`);
    expect(bad).toMatchObject({
      valid: false,
      suggestions: [{ field: 'team', didYouMean: `Kiểm thử ${TAG}` }],
    });
    expect(bad.error).toContain('team');
    const fields = await search.fields(ORG, a);
    expect(fields.teams.map((t) => t.value)).toContain(`Kiểm thử ${TAG}`);
  });

  // ───────────────────────── báo cáo theo team ─────────────────────────

  it('báo cáo dự án theo team: đếm việc + điểm CHỈ việc lá, người ở nhiều team tính vào từng team, dòng "Chưa thuộc team", lọc theo team', async () => {
    const p = await newProject();
    const qa = await svc.create(ORG, p.pid, { name: 'QA', memberIds: [a, b] }, ADMIN);
    const dev = await svc.create(ORG, p.pid, { name: 'Dev', memberIds: [b, c] }, ADMIN);
    await issue(p.pid, { assigneeId: a, points: 3 }); // QA, lá
    await issue(p.pid, { assigneeId: b, points: 2, done: true }); // QA+Dev, lá, xong
    await issue(p.pid, { assigneeId: c, points: 5, due: new Date('2020-01-01') }); // Dev, lá, quá hạn
    const parent = await issue(p.pid, { assigneeId: c, points: 4 }); // Dev, CHA (có con) → điểm không cộng
    await issue(p.pid, { assigneeId: a, points: 4, parentId: parent.id }); // QA, con (lá)
    await issue(p.pid, { assigneeId: d, points: 7 }); // không team
    await issue(p.pid, { points: 1 }); // chưa gán
    const rep = await analytics.projectReport(ORG, p.pid);
    const row = (tid: string | null) => rep.byTeam.find((t) => t.id === tid)!;
    expect(row(qa.id)).toMatchObject({
      name: 'QA',
      memberCount: 2,
      total: 3,
      done: 1,
      points: 3 + 2 + 4,
    });
    expect(row(dev.id)).toMatchObject({
      name: 'Dev',
      memberCount: 2,
      total: 3,
      done: 1,
      overdue: 1,
      points: 2 + 5,
    }); // cha (4) không cộng; b đếm cả hai team
    expect(row(null)).toMatchObject({ total: 2, points: 7 + 1 });
    expect(rep.totals.points).toBe(3 + 2 + 5 + 4 + 7 + 1); // cha 4 bị loại, con 4 vẫn tính
    // lọc theo team: mọi số liệu chỉ của team đó
    const f = await analytics.projectReport(ORG, p.pid, qa.id);
    expect(f.teamId).toBe(qa.id);
    expect(f.totals.total).toBe(3);
    expect(f.totals.points).toBe(9);
    expect(f.byTeam.map((t) => t.id)).toEqual([qa.id]);
    expect(f.byAssignee.every((x) => x.id === a || x.id === b)).toBe(true);
    expect(f.highPriUnassigned).toBe(0);
    await expect(analytics.projectReport(ORG, p.pid, 'khong-co')).rejects.toMatchObject({
      status: 422,
    });
    // dự án chưa có team: byTeam rỗng
    const empty = await newProject();
    expect((await analytics.projectReport(ORG, empty.pid)).byTeam).toEqual([]);
  });
});
