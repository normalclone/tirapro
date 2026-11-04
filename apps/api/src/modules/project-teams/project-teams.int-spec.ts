/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import { SYSTEM_ROLES } from '@tirapro/types';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MembersService } from '../members/members.service';
import { RbacService } from '../rbac/rbac.service';
import { TeamsService } from '../teams/teams.service';
import { ProjectTeamsService } from './project-teams.service';

/**
 * Team theo dự án TRÊN POSTGRES THẬT — OPT-IN, không chạy trong `pnpm test`. Spec thường mock Prisma nên không chứng minh được:
 * nguồn vai trò (direct / nhờ team), "chỉ mất vai trò khi hết nguồn", xoá thành viên khi hết vai trò, `roleId` luôn thuộc tập vai
 * trò, idempotent, và hai thay đổi đồng thời (gắn team ↔ đổi người) không làm lệch.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity project-teams`.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('team theo dự án ↔ Postgres thật', () => {
  const TAG = `pt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const ORG = id('org');
  const ADMIN = id('admin');
  const U = [1, 2, 3, 4, 5].map((n) => id(`u${n}`));
  const [u1, u2, u3, u4, u5] = U as [string, string, string, string, string];
  const R = { p1: id('rp1'), p2: id('rp2'), p3: id('rp3'), adminRole: id('radm') };
  const T = { a: id('ta'), b: id('tb') };
  const UM = id('um'); // Thành viên tổ chức thường (mặc định Developer ở dự án công khai)
  let prisma: PrismaClient;
  let pt: ProjectTeamsService;
  let teams: TeamsService;
  let rbacSvc: RbacService;
  let members: MembersService;
  const emit = vi.fn();
  let seq = 0;

  const newProject = async (isPrivate = false) => {
    const pid = id(`proj${++seq}`);
    await prisma.project.create({
      data: {
        id: pid,
        organizationId: ORG,
        key: `K${seq}${TAG}`.slice(0, 10).toUpperCase(),
        name: pid,
        isPrivate,
      },
    });
    return pid;
  };
  const resetTeam = async (teamId: string, ids: string[]) => {
    await prisma.teamMember.deleteMany({ where: { teamId } });
    await prisma.teamMember.createMany({ data: ids.map((userId) => ({ teamId, userId })) });
  };
  /** Trạng thái vai trò của người dùng ở dự án (sắp xếp để so sánh). */
  const state = async (projectId: string, userId: string) => {
    const m = await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: {
        roleId: true,
        roles: {
          select: { roleId: true, direct: true, teamSources: { select: { teamId: true } } },
        },
      },
    });
    if (!m) return null;
    const roles = m.roles
      .map((r) => ({
        roleId: r.roleId,
        direct: r.direct,
        teams: r.teamSources.map((t) => t.teamId).sort(),
      }))
      .sort((a, b) => a.roleId.localeCompare(b.roleId));
    return { primary: m.roleId, roles };
  };
  const roleIds = async (projectId: string, userId: string) =>
    ((await state(projectId, userId))?.roles ?? []).map((r) => r.roleId);
  const snapshot = async (projectId: string) => {
    const out: Record<string, unknown> = {};
    for (const u of U) out[u] = await state(projectId, u);
    return out;
  };
  /** Bất biến: mọi thành viên có ≥1 vai trò, `roleId` thuộc tập vai trò, mọi dòng vai trò đều có nguồn. */
  const assertInvariants = async (projectId: string) => {
    for (const u of U) {
      const s = await state(projectId, u);
      if (!s) continue;
      expect(s.roles.length, `${u} không còn vai trò`).toBeGreaterThan(0);
      expect(
        s.roles.map((r) => r.roleId),
        `${u} roleId ngoài tập`,
      ).toContain(s.primary);
      for (const r of s.roles)
        expect(r.direct || r.teams.length > 0, `${u}/${r.roleId} mồ côi`).toBe(true);
    }
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    for (const [key, scope] of [
      ['organization:admin', 'ORGANIZATION'],
      ['issue:edit', 'PROJECT'],
      ['project:admin', 'PROJECT'],
    ] as const)
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, scope },
      });
    for (const uid of [ADMIN, ...U])
      await prisma.user.create({
        data: { id: uid, email: `${uid}@pt.test`, displayName: uid, isSystemAdmin: uid === ADMIN },
      });
    await prisma.organization.create({ data: { id: ORG, name: TAG, slug: TAG, ownerId: ADMIN } });
    const perm = async (keys: string[]) =>
      (
        await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } })
      ).map((p) => ({
        permissionId: p.id,
      }));
    for (const [rid, keys] of [
      [R.p1, ['issue:edit']],
      [R.p2, ['issue:edit']],
      [R.p3, ['issue:edit']],
    ] as const)
      await prisma.role.create({
        data: {
          id: rid,
          organizationId: ORG,
          name: rid,
          scope: 'PROJECT',
          permissions: { create: await perm([...keys]) },
        },
      });
    await prisma.role.create({
      data: {
        id: R.adminRole,
        organizationId: ORG,
        name: R.adminRole,
        scope: 'PROJECT',
        permissions: { create: await perm(['project:admin']) },
      },
    });
    // Vai trò tổ chức tối thiểu để tạo OrganizationMembership (roleId bắt buộc).
    await prisma.role.create({
      data: { id: id('orgrole'), organizationId: ORG, name: id('orgrole'), scope: 'ORGANIZATION' },
    });
    for (const uid of [ADMIN, ...U])
      await prisma.organizationMembership.create({
        data: { organizationId: ORG, userId: uid, roleId: id('orgrole') },
      });
    await prisma.team.create({
      data: { id: T.a, organizationId: ORG, name: `A-${TAG}`, key: `a-${TAG}` },
    });
    await prisma.team.create({
      data: { id: T.b, organizationId: ORG, name: `B-${TAG}`, key: `b-${TAG}` },
    });

    // Quyền hiệu lực: Thành viên tổ chức (mặc định Developer) và một vai trò team hẹp (Reporter) — id cố định theo TAG.
    await prisma.permission.upsert({
      where: { key: 'project:view' },
      update: {},
      create: { key: 'project:view', description: 'project:view', scope: 'PROJECT' },
    });
    const orgMember = await prisma.role.create({
      data: {
        id: id('orgmember'),
        organizationId: ORG,
        name: SYSTEM_ROLES.ORGANIZATION_MEMBER,
        scope: 'ORGANIZATION',
      },
    });
    await prisma.role.create({
      data: {
        id: id('dev'),
        organizationId: ORG,
        name: SYSTEM_ROLES.DEVELOPER,
        scope: 'PROJECT',
        permissions: { create: await perm(['issue:edit']) },
      },
    });
    await prisma.role.create({
      data: {
        id: id('reporter'),
        organizationId: ORG,
        name: id('Reporter'),
        scope: 'PROJECT',
        permissions: { create: await perm(['project:view']) },
      },
    });
    await prisma.user.create({ data: { id: UM, email: `${UM}@pt.test`, displayName: UM } });
    const mm = await prisma.organizationMembership.create({
      data: { organizationId: ORG, userId: UM, roleId: orgMember.id },
    });
    await prisma.organizationMembershipRole.create({
      data: { membershipId: mm.id, roleId: orgMember.id },
    });

    const db = prisma as unknown as PrismaService;
    const rbac = new RbacService(db, { getClient: () => null, isAvailable: () => false } as never);
    rbacSvc = rbac;
    const audit = new AuditService(db);
    pt = new ProjectTeamsService(db, rbac, { emit } as never, audit);
    members = new MembersService(db, rbac, {} as never, { emit } as never, audit);
    teams = new TeamsService(db, members, { assertCanSee: vi.fn() } as never, pt);
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const like = { startsWith: TAG };
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG } });
    await prisma.project.deleteMany({ where: { id: like } });
    await prisma.team.deleteMany({ where: { id: like } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: ORG } });
    await prisma.role.deleteMany({ where: { id: like } });
    await prisma.organization.deleteMany({ where: { id: like } });
    await prisma.organizationMembershipRole.deleteMany({
      where: { membership: { organizationId: ORG } },
    });
    await prisma.user.deleteMany({ where: { id: like } });
    await prisma.$disconnect();
  }, 60_000);

  it('gắn team: mọi thành viên có vai trò nhờ team, roleId khớp, không phải direct', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1, u2]);
    const out = await pt.link(ORG, p, T.a, [R.p1, R.p2], ADMIN);
    expect(out).toHaveLength(1);
    expect(out[0]!.roles.map((r) => r.id)).toEqual([R.p1, R.p2]);
    expect(await state(p, u1)).toEqual({
      primary: R.p1,
      roles: [
        { roleId: R.p1, direct: false, teams: [T.a] },
        { roleId: R.p2, direct: false, teams: [T.a] },
      ],
    });
    expect(await state(p, u3)).toBeNull();
    await assertInvariants(p);
  });

  it('thêm / bớt người trong team tự đồng bộ mọi dự án đang gắn; bớt người xoá thành viên hết vai trò', async () => {
    const p1 = await newProject();
    const p2 = await newProject();
    await resetTeam(T.a, [u1]);
    await pt.link(ORG, p1, T.a, [R.p1], ADMIN);
    await pt.link(ORG, p2, T.a, [R.p2], ADMIN);
    await teams.setMembers(ORG, T.a, [u1, u2], ADMIN);
    expect(await roleIds(p1, u2)).toEqual([R.p1]);
    expect(await roleIds(p2, u2)).toEqual([R.p2]);
    await teams.setMembers(ORG, T.a, [u2], ADMIN);
    expect(await state(p1, u1)).toBeNull();
    expect(await state(p2, u1)).toBeNull();
    expect(await roleIds(p1, u2)).toEqual([R.p1]);
    // Qua `update` (memberIds + lead) cũng đồng bộ.
    await teams.update(ORG, T.a, { memberIds: [u2, u3], leadId: u4 }, ADMIN);
    expect(await roleIds(p1, u3)).toEqual([R.p1]);
    expect(await roleIds(p1, u4)).toEqual([R.p1]);
    await assertInvariants(p1);
    await assertInvariants(p2);
  });

  it('idempotent: đồng bộ lại không đổi gì (không bản ghi mới, không sự kiện)', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1, u2]);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    const before = await snapshot(p);
    const countRows = () =>
      prisma.projectMembershipRoleTeam.count({
        where: { teamId: T.a, membershipRole: { membership: { projectId: p } } },
      });
    const rows = await countRows();
    const fx = await prisma.$transaction((tx) => pt.syncTeam(tx, ORG, T.a));
    const fx2 = await prisma.$transaction((tx) => pt.syncTeam(tx, ORG, T.a));
    expect(await snapshot(p)).toEqual(before);
    expect(await countRows()).toBe(rows);
    for (const e of [...fx, ...fx2].filter((x) => x.projectId === p))
      expect([...e.added, ...e.removed, ...e.changed]).toEqual([]);
    // gắn lại cùng vai trò
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    expect(await snapshot(p)).toEqual(before);
  });

  it('gỡ team KHÔNG đụng vai trò gán trực tiếp; người chỉ có vai trò nhờ team bị gỡ khỏi dự án', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1, u2]);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    await members.setProjectRoles(ORG, p, u2, [R.p2], ADMIN); // direct p2, p1 vẫn nhờ team
    expect(await state(p, u2)).toEqual({
      primary: R.p2,
      roles: [
        { roleId: R.p1, direct: false, teams: [T.a] },
        { roleId: R.p2, direct: true, teams: [] },
      ],
    });
    await pt.unlink(ORG, p, T.a, ADMIN);
    expect(await state(p, u1)).toBeNull(); // chỉ nhờ team → rời dự án
    expect(await state(p, u2)).toEqual({
      primary: R.p2,
      roles: [{ roleId: R.p2, direct: true, teams: [] }],
    });
    expect(await prisma.projectTeamLink.count({ where: { projectId: p } })).toBe(0);
    await assertInvariants(p);
  });

  it('cùng một vai trò vừa direct vừa nhờ team: bớt khỏi team vẫn giữ (direct)', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1]);
    await members.addProject(ORG, p, u1, [R.p1], ADMIN); // direct p1
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    expect(await state(p, u1)).toEqual({
      primary: R.p1,
      roles: [{ roleId: R.p1, direct: true, teams: [T.a] }],
    });
    await teams.setMembers(ORG, T.a, [u2], ADMIN);
    expect(await state(p, u1)).toEqual({
      primary: R.p1,
      roles: [{ roleId: R.p1, direct: true, teams: [] }],
    });
  });

  it('hai team cùng cho một vai trò: chỉ mất khi cả hai hết; xoá team gỡ phần của nó khỏi mọi dự án', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1]);
    await resetTeam(T.b, [u1]);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    await pt.link(ORG, p, T.b, [R.p1, R.p3], ADMIN);
    expect((await state(p, u1))!.roles.find((r) => r.roleId === R.p1)!.teams).toEqual(
      [T.a, T.b].sort(),
    );
    await teams.setMembers(ORG, T.a, [u2], ADMIN);
    expect(await roleIds(p, u1)).toEqual([R.p1, R.p3].sort());
    // Xoá team B (hard delete): u1 hết nguồn → rời dự án; u2 (nhờ A) vẫn còn
    await teams.remove(ORG, T.b, ADMIN);
    expect(await state(p, u1)).toBeNull();
    expect(await roleIds(p, u2)).toEqual([R.p1]);
    expect(await prisma.projectTeamLink.count({ where: { teamId: T.b } })).toBe(0);
    await assertInvariants(p);
    // dựng lại team B cho các ca sau
    await prisma.team.create({
      data: { id: T.b, organizationId: ORG, name: `B-${TAG}`, key: `b-${TAG}` },
    });
  });

  it('đổi vai trò của team: thêm/bớt đúng phần của team, roleId đi theo tập mới', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1]);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    await pt.link(ORG, p, T.a, [R.p2, R.p3], ADMIN);
    expect(await state(p, u1)).toEqual({
      primary: R.p2 < R.p3 ? R.p2 : R.p3,
      roles: [
        { roleId: R.p2, direct: false, teams: [T.a] },
        { roleId: R.p3, direct: false, teams: [T.a] },
      ],
    });
    await assertInvariants(p);
  });

  it('thành viên cũ chỉ có roleId (không dòng nối): giữ vai trò chính khi thêm/gỡ vai trò nhờ team', async () => {
    const p = await newProject();
    await prisma.projectMembership.create({ data: { projectId: p, userId: u1, roleId: R.p1 } }); // không roles
    await resetTeam(T.a, [u1]);
    await pt.link(ORG, p, T.a, [R.p2], ADMIN);
    expect(await state(p, u1)).toEqual({
      primary: R.p1,
      roles: [
        { roleId: R.p1, direct: true, teams: [] },
        { roleId: R.p2, direct: false, teams: [T.a] },
      ],
    });
    await pt.unlink(ORG, p, T.a, ADMIN);
    expect(await state(p, u1)).toEqual({
      primary: R.p1,
      roles: [{ roleId: R.p1, direct: true, teams: [] }],
    });
  });

  it('clearProjectOverride (xoá vai trò riêng): chỉ bỏ phần direct, vai trò nhờ team ở lại; hết thì xoá thành viên', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1]);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    await members.setProjectRoles(ORG, p, u1, [R.p2, R.p1], ADMIN);
    await members.clearProjectOverride(ORG, p, u1, ADMIN);
    expect(await state(p, u1)).toEqual({
      primary: R.p1,
      roles: [{ roleId: R.p1, direct: false, teams: [T.a] }],
    });
    await members.clearProjectOverride(ORG, p, u1, ADMIN); // lần nữa: không còn direct, không đổi
    expect((await state(p, u1))!.roles).toHaveLength(1);
    // người chỉ có direct → thành viên bị xoá như cũ
    await members.addProject(ORG, p, u2, [R.p3], ADMIN);
    await members.clearProjectOverride(ORG, p, u2, ADMIN);
    expect(await state(p, u2)).toBeNull();
  });

  it('API danh sách thành viên dự án trả nguồn từng vai trò (direct / teams)', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1]);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    await members.setProjectRoles(ORG, p, u1, [R.p2], ADMIN);
    const list = (await members.listProject(ORG, p)) as Array<{
      user: { id: string };
      roles: Array<{ id: string; direct?: boolean; teams?: Array<{ id: string }> }>;
    }>;
    const row = list.find((r) => r.user.id === u1)!;
    expect(row.roles.find((r) => r.id === R.p1)).toMatchObject({
      direct: false,
      teams: [{ id: T.a }],
    });
    expect(row.roles.find((r) => r.id === R.p2)).toMatchObject({ direct: true });
  });

  it('dự án riêng tư: không xoá thành viên cuối — đồng bộ giữ lại, gỡ team báo lỗi và hoàn lại', async () => {
    const p = await newProject(true);
    await resetTeam(T.a, [u1]);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    const effects = await prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({ where: { teamId: T.a } });
      return pt.syncTeam(tx, ORG, T.a);
    });
    expect(effects.find((e) => e.projectId === p)!.kept).toEqual([u1]);
    expect(await roleIds(p, u1)).toEqual([R.p1]); // vẫn là thành viên cuối
    await expect(pt.unlink(ORG, p, T.a, ADMIN)).rejects.toMatchObject({ status: 422 });
    expect(await prisma.projectTeamLink.count({ where: { projectId: p } })).toBe(1);
    expect(await roleIds(p, u1)).toEqual([R.p1]);
    // thêm người khác rồi mới gỡ được
    await members.addProject(ORG, p, u2, [R.p1], ADMIN);
    await pt.unlink(ORG, p, T.a, ADMIN);
    expect(await state(p, u1)).toBeNull();
    // xoá vai trò riêng của thành viên cuối dự án riêng tư vẫn bị chặn
    await expect(members.clearProjectOverride(ORG, p, u2, ADMIN)).rejects.toMatchObject({
      status: 422,
    });
    expect(await roleIds(p, u2)).toEqual([R.p1]);
  });

  it('xoá team là nguồn duy nhất của thành viên cuối dự án riêng tư: giữ thành viên, vai trò chuyển thành gán trực tiếp (không mồ côi)', async () => {
    const p = await newProject(true);
    const tid = id(`tdel${++seq}`);
    await prisma.team.create({ data: { id: tid, organizationId: ORG, name: tid, key: tid } });
    await prisma.teamMember.create({ data: { teamId: tid, userId: u1 } });
    await pt.link(ORG, p, tid, [R.p1, R.p2], ADMIN);
    await teams.remove(ORG, tid, ADMIN);
    expect(await prisma.projectTeamLink.count({ where: { teamId: tid } })).toBe(0);
    expect(await state(p, u1)).toEqual({
      primary: R.p1,
      roles: [
        { roleId: R.p1, direct: true, teams: [] },
        { roleId: R.p2, direct: true, teams: [] },
      ],
    });
    await assertInvariants(p);
    const log = await prisma.auditLog.findFirst({
      where: { organizationId: ORG, entityId: tid, action: 'project_team.synced' },
    });
    expect((log?.meta as { keptPromotedToDirect?: string[] }).keptPromotedToDirect).toEqual([u1]);
  });

  it('gắn team KHÔNG BAO GIỜ làm giảm quyền ở dự án công khai: vai trò mặc định theo tổ chức vẫn được cộng; dự án riêng tư chỉ có vai trò team', async () => {
    const reporter = id('reporter');
    const perms = async (p: string) =>
      [...(await rbacSvc.getEffectivePermissions(UM, ORG, p))].sort();
    await resetTeam(T.a, [UM]);

    const pub = await newProject();
    const baseline = await perms(pub);
    expect(baseline).toContain('issue:edit'); // mặc định Developer
    await pt.link(ORG, pub, T.a, [reporter], ADMIN);
    expect((await state(pub, UM))!.roles).toEqual([
      { roleId: reporter, direct: false, teams: [T.a] },
    ]);
    expect(await perms(pub)).toEqual(expect.arrayContaining([...baseline, 'project:view'])); // giữ nguyên mọi quyền mặc định + thêm Reporter
    // Danh sách thành viên cũng hiện đúng thứ người đó có
    const list = (await members.listProject(ORG, pub)) as Array<{
      user: { id: string };
      roles: Array<{ id: string; name: string }>;
    }>;
    expect(list.find((r) => r.user.id === UM)!.roles.map((r) => r.name)).toEqual(
      expect.arrayContaining([id('Reporter'), SYSTEM_ROLES.DEVELOPER]),
    );

    // Gán trực tiếp = ghi đè tường minh: quay về nghĩa "thay thế" (chỉ vai trò đã chọn)
    await members.setProjectRoles(ORG, pub, UM, [reporter], ADMIN);
    expect(await perms(pub)).not.toContain('issue:edit');
    await members.clearProjectOverride(ORG, pub, UM, ADMIN); // còn nhờ team → lại cộng mặc định
    expect(await perms(pub)).toContain('issue:edit');

    // Gỡ team: về hẳn mặc định
    await pt.unlink(ORG, pub, T.a, ADMIN);
    expect(await state(pub, UM)).toBeNull();
    expect(await perms(pub)).toEqual(baseline);

    // Dự án riêng tư: không bao giờ cộng mặc định — chỉ vai trò team
    const priv = await newProject(true);
    await members.addProject(ORG, priv, u1, [R.p1], ADMIN); // còn người khác để gỡ team được
    await pt.link(ORG, priv, T.a, [reporter], ADMIN);
    expect(await perms(priv)).toEqual(['project:view']);
    await pt.unlink(ORG, priv, T.a, ADMIN);
    expect(await perms(priv)).toEqual([]);
  });

  it('thành viên cuối dự án riêng tư: chỉ tính người còn hoạt động trong tổ chức (đồng bộ và xoá vai trò riêng cùng một quy tắc)', async () => {
    const p = await newProject(true);
    await resetTeam(T.a, [u1]);
    await members.addProject(ORG, p, u2, [R.p1], ADMIN);
    await pt.link(ORG, p, T.a, [R.p2], ADMIN); // u1 nhờ team, u2 trực tiếp
    await prisma.user.update({ where: { id: u2 }, data: { status: 'DEACTIVATED' } }); // u2 không còn tính là thành viên
    const fx = await prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({ where: { teamId: T.a } });
      return pt.syncTeam(tx, ORG, T.a);
    });
    expect(fx.find((e) => e.projectId === p)!.kept).toEqual([u1]);
    expect(await roleIds(p, u1)).toEqual([R.p2]);
    await prisma.user.update({ where: { id: u2 }, data: { status: 'ACTIVE' } });
    await prisma.$transaction((tx) => pt.syncTeam(tx, ORG, T.a)); // u2 hoạt động lại → u1 gỡ được
    expect(await state(p, u1)).toBeNull();
  });

  it('sửa thành viên / xoá team đang gắn vai trò quản trị: team:manage một mình không đủ, quản trị tổ chức thì được', async () => {
    const p = await newProject();
    const risky = id('rrisky2');
    await prisma.role.create({
      data: {
        id: risky,
        organizationId: ORG,
        name: risky,
        scope: 'PROJECT',
        permissions: {
          create: (
            await prisma.permission.findMany({
              where: { key: 'organization:admin' },
              select: { id: true },
            })
          ).map((x) => ({ permissionId: x.id })),
        },
      },
    });
    await resetTeam(T.a, [u1]);
    await pt.link(ORG, p, T.a, [risky], ADMIN);
    const denied = { code: 'ADMIN_GRANT_REQUIRES_ADMIN' };
    await expect(teams.setMembers(ORG, T.a, [u1, u3], u2)).rejects.toMatchObject(denied);
    await expect(teams.update(ORG, T.a, { memberIds: [u1, u3] }, u2)).rejects.toMatchObject(denied);
    await expect(teams.update(ORG, T.a, { leadId: u3 }, u2)).rejects.toMatchObject(denied);
    await expect(teams.remove(ORG, T.a, u2)).rejects.toMatchObject(denied);
    expect(await state(p, u3)).toBeNull();
    // đổi tên/mô tả (không đụng thành viên) vẫn được
    await expect(teams.update(ORG, T.a, { description: 'x' }, u2)).resolves.toBeTruthy();
    await teams.setMembers(ORG, T.a, [u1, u3], ADMIN); // quản trị thì được
    expect(await roleIds(p, u3)).toEqual([risky]);
    await pt.unlink(ORG, p, T.a, ADMIN);
    // team không gắn vai trò quản trị: team:manage như cũ
    await expect(teams.setMembers(ORG, T.a, [u1], u2)).resolves.toBeTruthy();
  });

  it('đồng thời: xoá team ↔ gắn team không để lại vai trò mồ côi', async () => {
    for (let round = 0; round < 3; round++) {
      const p = await newProject();
      const tid = id(`tcc${++seq}`);
      await prisma.team.create({ data: { id: tid, organizationId: ORG, name: tid, key: tid } });
      await prisma.teamMember.createMany({
        data: [u1, u2].map((userId) => ({ teamId: tid, userId })),
      });
      const settled = await Promise.allSettled([
        pt.link(ORG, p, tid, [R.p1], ADMIN),
        teams.remove(ORG, tid, ADMIN),
      ]);
      expect(settled.some((r) => r.status === 'fulfilled')).toBe(true);
      expect(await prisma.team.count({ where: { id: tid } })).toBe(0);
      expect(await prisma.projectTeamLink.count({ where: { projectId: p } })).toBe(0);
      expect(await snapshot(p)).toEqual(Object.fromEntries(U.map((u) => [u, null])));
      await assertInvariants(p);
    }
  });

  it('tài khoản vô hiệu hoá / người đã rời tổ chức không nhận vai trò; người đã nhận mà hết đủ điều kiện bị gỡ khi đồng bộ', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1, u5]);
    await prisma.user.update({ where: { id: u5 }, data: { status: 'DEACTIVATED' } });
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    expect(await state(p, u5)).toBeNull();
    expect(await roleIds(p, u1)).toEqual([R.p1]);
    await prisma.user.update({ where: { id: u1 }, data: { status: 'DEACTIVATED' } });
    await prisma.$transaction((tx) => pt.syncTeam(tx, ORG, T.a));
    expect(await state(p, u1)).toBeNull();
    await prisma.user.updateMany({ where: { id: { in: [u1, u5] } }, data: { status: 'ACTIVE' } });
  });

  it('đồng thời: gắn team ↔ đổi người ↔ gắn lần nữa không làm lệch (mọi thành viên cuối cùng đều đúng)', async () => {
    for (let round = 0; round < 3; round++) {
      const p = await newProject();
      await resetTeam(T.a, [u1, u2]);
      await Promise.all([
        pt.link(ORG, p, T.a, [R.p1], ADMIN),
        teams.setMembers(ORG, T.a, [u2, u3, u4], ADMIN),
        pt.link(ORG, p, T.a, [R.p1], ADMIN),
        teams.setMembers(ORG, T.a, [u3, u4, u5], ADMIN),
      ]);
      const final = (
        await prisma.teamMember.findMany({ where: { teamId: T.a }, select: { userId: true } })
      ).map((m) => m.userId);
      for (const u of U) {
        const has = (await roleIds(p, u)).includes(R.p1);
        expect(has, `vòng ${round}: ${u} thành viên team=${final.includes(u)}`).toBe(
          final.includes(u),
        );
      }
      await assertInvariants(p);
    }
  });

  it('đồng thời: hai team khác nhau cùng đổi một người trên cùng dự án không mất vai trò của nhau', async () => {
    const p = await newProject();
    await resetTeam(T.a, []);
    await resetTeam(T.b, []);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN);
    await pt.link(ORG, p, T.b, [R.p2], ADMIN);
    await Promise.all([
      teams.setMembers(ORG, T.a, [u1], ADMIN),
      teams.setMembers(ORG, T.b, [u1], ADMIN),
    ]);
    expect(await roleIds(p, u1)).toEqual([R.p1, R.p2].sort());
    await Promise.all([
      teams.setMembers(ORG, T.a, [u2], ADMIN),
      teams.setMembers(ORG, T.b, [u2], ADMIN),
    ]);
    expect(await state(p, u1)).toBeNull();
    expect(await roleIds(p, u2)).toEqual([R.p1, R.p2].sort());
    await assertInvariants(p);
  });

  it('không leo thang: người không phải quản trị tổ chức không gắn được team với vai trò mang quyền quản trị tổ chức', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1]);
    const risky = id('rrisky');
    await prisma.role.create({
      data: {
        id: risky,
        organizationId: ORG,
        name: risky,
        scope: 'PROJECT',
        permissions: {
          create: (
            await prisma.permission.findMany({
              where: { key: 'organization:admin' },
              select: { id: true },
            })
          ).map((x) => ({
            permissionId: x.id,
          })),
        },
      },
    });
    await expect(pt.link(ORG, p, T.a, [risky], u2)).rejects.toMatchObject({
      code: 'ADMIN_GRANT_REQUIRES_ADMIN',
    });
    expect(await state(p, u1)).toBeNull();
    expect(await prisma.projectTeamLink.count({ where: { projectId: p } })).toBe(0);
    await pt.link(ORG, p, T.a, [risky], ADMIN); // quản trị thì được
    expect(await roleIds(p, u1)).toEqual([risky]);
    // Chiều GỠ cũng chỉ quản trị tổ chức làm được: đổi sang vai trò thường hoặc gỡ team đều bị chặn, không đổi gì.
    await expect(pt.link(ORG, p, T.a, [R.p1], u2)).rejects.toMatchObject({
      code: 'ADMIN_GRANT_REQUIRES_ADMIN',
    });
    await expect(pt.unlink(ORG, p, T.a, u2)).rejects.toMatchObject({
      code: 'ADMIN_GRANT_REQUIRES_ADMIN',
    });
    expect(await roleIds(p, u1)).toEqual([risky]);
    expect(await prisma.projectTeamLink.count({ where: { projectId: p } })).toBe(1);
    await pt.link(ORG, p, T.a, [R.p1], ADMIN); // quản trị thì đổi/gỡ được
    expect(await roleIds(p, u1)).toEqual([R.p1]);
  });

  it('vai trò sai cấp / team ngoài tổ chức → từ chối; gỡ team chưa gắn → 404', async () => {
    const p = await newProject();
    await resetTeam(T.a, [u1]);
    await expect(pt.link(ORG, p, T.a, [id('orgrole')], ADMIN)).rejects.toMatchObject({
      status: 403,
    });
    await expect(pt.link(ORG, p, id('nope'), [R.p1], ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(pt.unlink(ORG, p, T.b, ADMIN)).rejects.toMatchObject({ status: 404 });
    expect(await state(p, u1)).toBeNull();
  });
});
