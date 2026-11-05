/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLES } from '@tirapro/types';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { AuthUser } from '../../common/types/request';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MembersService } from '../members/members.service';
import { RbacService } from '../rbac/rbac.service';
import { AssistantBulkService } from './assistant-bulk.service';

/**
 * Lệnh hàng loạt của Trợ lý TRÊN POSTGRES THẬT — OPT-IN, không chạy trong `pnpm test`. AssistantBulkService + MembersService +
 * RbacService THẬT (Redis tắt). Chứng minh những điều spec mock chỉ suy ra từ việc đọc mã: thêm vào dự án RIÊNG TƯ thật sự tạo
 * thành viên, gỡ khỏi dự án riêng tư thật sự thu hồi truy cập và luôn còn ≥ 1 thành viên, gỡ ở dự án CÔNG KHAI chỉ về vai trò
 * mặc định (không rời dự án), chặn bỏ quản trị viên cuối / tự khoá mình, và việc ở dự án người gọi không xem được có CÙNG dạng
 * trả về với id không tồn tại.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity assistant-bulk`.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('lệnh hàng loạt của Trợ lý ↔ Postgres thật', () => {
  const TAG = `ab${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const ORG = id('org');
  const U = {
    admin: id('admin'), // quản trị tổ chức
    pa: id('pa'),
    pa2: id('pa2'),
    m1: id('m1'),
    m2: id('m2'),
    viewer: id('viewer'),
  };
  const R = { admin: id('rpadmin'), dev: id('rdev'), tester: id('rtester') };
  let prisma: PrismaClient;
  let svc: AssistantBulkService;
  let members: MembersService;
  let seq = 0;
  let issueSeq = 0;
  let typeId = '';
  let statusId = '';

  const actor = (userId: string): AuthUser => ({
    id: userId,
    email: `${userId}@ab.test`,
    displayName: userId,
    organizationId: ORG,
    isSystemAdmin: false,
  });
  const newProject = async (isPrivate: boolean, withMembers: Array<[string, string[]]> = []) => {
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
    for (const [userId, roleIds] of withMembers)
      await prisma.projectMembership.create({
        data: {
          projectId: pid,
          userId,
          roleId: roleIds[0]!,
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
        },
      });
    return pid;
  };
  const overrideRoles = async (projectId: string, userId: string) => {
    const m = await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { roles: { select: { roleId: true } } },
    });
    return m ? m.roles.map((r) => r.roleId).sort() : null;
  };
  const row = (
    projectId: string,
    userId: string,
    expectRoles: string[] | null,
    set: string[] | null,
  ) => ({ projectId, userId, expect: expectRoles, set });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    const keys = [
      ['organization:admin', 'ORGANIZATION'],
      ['project:view', 'PROJECT'],
      ['project:admin', 'PROJECT'],
      ['issue:edit', 'PROJECT'],
      ['issue:assign', 'PROJECT'],
    ] as const;
    for (const [key, scope] of keys)
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: key, scope },
      });
    for (const uid of Object.values(U))
      await prisma.user.create({ data: { id: uid, email: `${uid}@ab.test`, displayName: uid } });
    await prisma.organization.create({
      data: { id: ORG, name: TAG, slug: TAG, ownerId: U.admin },
    });
    const perm = async (ks: string[]) =>
      (await prisma.permission.findMany({ where: { key: { in: ks } }, select: { id: true } })).map(
        (p) => ({ permissionId: p.id }),
      );
    const role = (rid: string, name: string, scope: 'ORGANIZATION' | 'PROJECT', ks: string[]) =>
      perm(ks).then((permissions) =>
        prisma.role.create({
          data: { id: rid, organizationId: ORG, name, scope, permissions: { create: permissions } },
        }),
      );
    const orgAdminRole = await role(
      id('orgadmin'),
      SYSTEM_ROLES.ORGANIZATION_ADMIN,
      'ORGANIZATION',
      ['organization:admin', 'project:view', 'project:admin', 'issue:edit', 'issue:assign'],
    );
    const orgMemberRole = await role(
      id('orgmember'),
      SYSTEM_ROLES.ORGANIZATION_MEMBER,
      'ORGANIZATION',
      ['project:view'],
    );
    await role(R.admin, SYSTEM_ROLES.PROJECT_ADMIN, 'PROJECT', [
      'project:view',
      'project:admin',
      'issue:edit',
      'issue:assign',
    ]);
    await role(R.dev, SYSTEM_ROLES.DEVELOPER, 'PROJECT', [
      'project:view',
      'issue:edit',
      'issue:assign',
    ]);
    await role(R.tester, 'Tester', 'PROJECT', ['project:view']);
    for (const uid of Object.values(U)) {
      const roleId = uid === U.admin ? orgAdminRole.id : orgMemberRole.id;
      const m = await prisma.organizationMembership.create({
        data: { organizationId: ORG, userId: uid, roleId },
      });
      await prisma.organizationMembershipRole.create({ data: { membershipId: m.id, roleId } });
    }
    const wf = await prisma.workflow.create({ data: { organizationId: ORG, name: TAG } });
    statusId = (
      await prisma.status.create({
        data: { workflowId: wf.id, name: 'To Do', category: 'TODO', isInitial: true },
      })
    ).id;
    typeId = (await prisma.issueType.create({ data: { organizationId: ORG, name: TAG } })).id;

    const db = prisma as unknown as PrismaService;
    const rbac = new RbacService(db, { getClient: () => null, isAvailable: () => false } as never);
    const emit = vi.fn();
    const audit = new AuditService(db);
    members = new MembersService(db, rbac, {} as never, { emit } as never, audit);
    const issues = {
      bulkUpdate: vi.fn(() => Promise.resolve({ updated: [], conflicts: [] })),
      isAssignableMember: vi.fn(() => Promise.resolve(true)),
    };
    svc = new AssistantBulkService(db, rbac, issues as never, members);
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    const like = { startsWith: TAG };
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG } });
    await prisma.issue.deleteMany({ where: { organizationId: ORG } });
    await prisma.project.deleteMany({ where: { id: like } });
    await prisma.issueType.deleteMany({ where: { organizationId: ORG } });
    await prisma.workflow.deleteMany({ where: { organizationId: ORG } });
    await prisma.organizationMembershipRole.deleteMany({
      where: { membership: { organizationId: ORG } },
    });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: ORG } });
    await prisma.role.deleteMany({ where: { id: like } });
    await prisma.organization.deleteMany({ where: { id: like } });
    await prisma.user.deleteMany({ where: { id: like } });
    await prisma.$disconnect();
  }, 60_000);

  it('THÊM vào dự án RIÊNG TƯ thật sự tạo thành viên (người đó thấy dự án); thêm vai trò = hợp, không mất vai trò', async () => {
    const p = await newProject(true, [[U.pa, [R.admin]]]);
    const res = await svc.setMembers(ORG, actor(U.admin), [row(p, U.m1, null, [R.dev])]);
    expect(res.results[0]).toMatchObject({ status: 'ok', before: null, after: [R.dev] });
    expect(await overrideRoles(p, U.m1)).toEqual([R.dev]);
    const listed = await members.listProject(ORG, p);
    expect(listed.map((m) => m.user.id).sort()).toEqual([U.pa, U.m1].sort());
    // m1 nay có thể XEM dự án (trước đó dự án riêng tư là 404 với họ)
    const rbac = new RbacService(
      prisma as unknown as PrismaService,
      {
        getClient: () => null,
        isAvailable: () => false,
      } as never,
    );
    await expect(rbac.assertProjectVisible(U.m1, ORG, p, 'Dự án', false)).resolves.toBeUndefined();
    // hợp vai trò: thêm Tester vào [Developer] → [Developer, Tester]
    const merged = await svc.setMembers(ORG, actor(U.admin), [
      row(p, U.m1, [R.dev], [R.dev, R.tester]),
    ]);
    expect(merged.results[0]!.status).toBe('ok');
    expect(await overrideRoles(p, U.m1)).toEqual([R.dev, R.tester].sort());
  });

  it('GỠ khỏi dự án RIÊNG TƯ thật sự thu hồi truy cập; Hoàn tác đưa về đúng vai trò cũ', async () => {
    const p = await newProject(true, [
      [U.pa, [R.admin]],
      [U.m1, [R.dev, R.tester]],
    ]);
    const res = await svc.setMembers(ORG, actor(U.admin), [row(p, U.m1, [R.dev, R.tester], null)]);
    expect(res.results[0]).toMatchObject({ status: 'ok', after: null });
    expect(await overrideRoles(p, U.m1)).toBeNull();
    const rbac = new RbacService(
      prisma as unknown as PrismaService,
      {
        getClient: () => null,
        isAvailable: () => false,
      } as never,
    );
    await expect(rbac.assertProjectVisible(U.m1, ORG, p, 'Dự án', false)).rejects.toThrow();
    // còn ≥ 1 thành viên
    expect((await members.listProject(ORG, p)).map((m) => m.user.id)).toEqual([U.pa]);
    // Hoàn tác = đảo chiều đúng trạng thái trước/sau
    const undo = await svc.setMembers(ORG, actor(U.admin), [
      row(p, U.m1, res.results[0]!.after, res.results[0]!.before),
    ]);
    expect(undo.results[0]!.status).toBe('ok');
    expect(await overrideRoles(p, U.m1)).toEqual([R.dev, R.tester].sort());
  });

  it('GỠ người cuối của dự án riêng tư bị từ chối (dự án luôn còn ≥ 1 thành viên), dữ liệu không đổi', async () => {
    const p = await newProject(true, [[U.m1, [R.dev]]]);
    const res = await svc.setMembers(ORG, actor(U.admin), [row(p, U.m1, [R.dev], null)]);
    expect(res.results[0]!.status).toBe('failed');
    expect(res.results[0]!.reason).toMatch(/ít nhất một thành viên/);
    expect(await overrideRoles(p, U.m1)).toEqual([R.dev]);
  });

  it('GỠ ở dự án CÔNG KHAI chỉ gỡ vai trò riêng → người đó VẪN thuộc dự án với vai trò mặc định tổ chức', async () => {
    const p = await newProject(false);
    const add = await svc.setMembers(ORG, actor(U.admin), [row(p, U.m2, null, [R.tester])]);
    expect(add.results[0]!.status).toBe('ok');
    expect(await overrideRoles(p, U.m2)).toEqual([R.tester]);
    const rm = await svc.setMembers(ORG, actor(U.admin), [row(p, U.m2, [R.tester], null)]);
    expect(rm.results[0]).toMatchObject({ status: 'ok', before: [R.tester], after: null });
    expect(await overrideRoles(p, U.m2)).toBeNull();
    const listed = (await members.listProject(ORG, p)).find((m) => m.user.id === U.m2)!;
    expect(listed.isOverride).toBe(false);
    expect(listed.roles.map((r) => r.id)).toEqual([R.dev]); // mặc định của "Organization Member"
    // gỡ lần nữa: không có gì để gỡ
    const again = await svc.setMembers(ORG, actor(U.admin), [row(p, U.m2, null, null)]);
    expect(again.results[0]).toMatchObject({
      status: 'skipped',
      reason: 'Không có vai trò riêng để gỡ.',
    });
  });

  it('CHẶN bỏ quản trị viên cuối của dự án riêng tư (kể cả do quản trị tổ chức); thêm quản trị khác thì gỡ được', async () => {
    const p = await newProject(true, [
      [U.pa, [R.admin]],
      [U.m1, [R.dev]],
    ]);
    const blocked = await svc.setMembers(ORG, actor(U.admin), [row(p, U.pa, [R.admin], null)]);
    expect(blocked.results[0]).toMatchObject({ status: 'skipped' });
    expect(blocked.results[0]!.reason).toMatch(/không còn quản trị viên nào/);
    expect(await overrideRoles(p, U.pa)).toEqual([R.admin]);
    const add = await svc.setMembers(ORG, actor(U.admin), [row(p, U.pa2, null, [R.admin])]);
    expect(add.results[0]!.status).toBe('ok');
    const ok = await svc.setMembers(ORG, actor(U.admin), [row(p, U.pa, [R.admin], null)]);
    expect(ok.results[0]!.status).toBe('ok');
    expect(await overrideRoles(p, U.pa)).toBeNull();
  });

  it('CHẶN tự bỏ / tự hạ quyền quản trị của chính mình; người khác trong cùng lô vẫn làm được', async () => {
    const p = await newProject(false, [
      [U.pa, [R.admin]],
      [U.pa2, [R.admin]],
    ]);
    const res = await svc.setMembers(ORG, actor(U.pa), [
      row(p, U.pa, [R.admin], [R.tester]),
      row(p, U.pa2, [R.admin], [R.tester]),
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['skipped', 'ok']);
    expect(res.results[0]!.reason).toMatch(/tự bỏ quyền quản trị của chính mình/);
    expect(await overrideRoles(p, U.pa)).toEqual([R.admin]);
    expect(await overrideRoles(p, U.pa2)).toEqual([R.tester]);
  });

  it('người không phải quản trị dự án: không dòng nào được thực hiện', async () => {
    const p = await newProject(false, [[U.m1, [R.dev]]]);
    const res = await svc.setMembers(ORG, actor(U.m1), [row(p, U.m2, null, [R.tester])]);
    expect(res.results[0]).toMatchObject({ status: 'skipped' });
    expect(await overrideRoles(p, U.m2)).toBeNull();
  });

  it('GIAO VIỆC: việc ở dự án riêng tư người gọi không xem được trả CÙNG dạng với id không tồn tại (mọi trường null)', async () => {
    const p = await newProject(true, [[U.pa, [R.admin]]]);
    const issueId = id(`iss${++issueSeq}`);
    await prisma.issue.create({
      data: {
        id: issueId,
        organizationId: ORG,
        projectId: p,
        number: 1,
        key: `SECRET-${issueSeq}`,
        typeId,
        statusId,
        summary: 'Việc bí mật',
        assigneeId: U.pa,
        rank: 'a',
        version: 9,
      },
    });
    const res = await svc.assign(ORG, actor(U.viewer), [
      { issueId, version: 9, assigneeId: U.m1 },
      { issueId: id('ghost'), version: 9, assigneeId: U.m1 },
    ]);
    expect(res.results[0]).toEqual({ ...res.results[1]!, issueId });
    expect(res.results[0]).toMatchObject({
      key: null,
      previousAssigneeId: null,
      assigneeId: null,
      version: null,
      status: 'skipped',
    });
    expect(JSON.stringify(res)).not.toContain('SECRET');
  });
});
