/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { ProjectAccessService } from '../rbac/project-access.service';
import { RbacService } from '../rbac/rbac.service';
import { DashboardsService } from './dashboards.service';

/**
 * Phạm vi DỮ LIỆU của dashboard TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). DashboardsService + ProjectAccessService THẬT;
 * RBAC giả (quản trị thấy mọi dự án, người thường thấy công khai + dự án mình là thành viên). Kiểm điểm rủi ro nhất:
 * dashboard NHÓM của chủ, người khác xem → chỉ thấy dự án của nhóm mà HỌ được thấy; ORG chỉ admin; đổi phạm vi chỉ đổi ô
 * kế thừa; nhóm bị xoá → danh sách rỗng (không thành "mọi dự án"); dashboard cũ (chưa chọn phạm vi) = ORG.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('phạm vi dữ liệu dashboard ↔ Postgres thật', () => {
  const TAG = `ds${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const U = { owner: id('owner'), viewer: id('viewer'), admin: id('admin'), other: id('other') };
  const WS = id('ws');
  const P = { pub1: id('pub1'), pub2: id('pub2'), priv: id('priv'), del: id('del') };
  const G = { own: id('gown'), others: id('gother') };

  let prisma: PrismaClient;
  let svc: DashboardsService;

  const idsOf = (d: { scopeProjects: Array<{ id: string }> | null }) =>
    d.scopeProjects === null ? null : d.scopeProjects.map((p) => p.id).sort();
  const share = (dashboardId: string) =>
    prisma.dashboard.update({ where: { id: dashboardId }, data: { scope: 'GLOBAL' } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    for (const [k, u] of Object.entries(U))
      await prisma.user.create({
        data: { id: u, email: `${u}@x.test`, displayName: k, status: 'ACTIVE' },
      });
    await prisma.organization.create({ data: { id: WS, name: WS, slug: WS, ownerId: U.admin } });
    await prisma.role.create({
      data: { id: id('wrole'), organizationId: WS, name: 'R', scope: 'ORGANIZATION' },
    });
    await prisma.role.create({
      data: { id: id('prole'), organizationId: WS, name: 'PR', scope: 'PROJECT' },
    });
    for (const u of Object.values(U))
      await prisma.organizationMembership.create({
        data: { organizationId: WS, userId: u, roleId: id('wrole') },
      });
    const k = TAG.slice(2, 7).toUpperCase();
    const proj = (pid: string, key: string, over: Record<string, unknown> = {}) =>
      prisma.project.create({
        data: { id: pid, organizationId: WS, key: `${k}${key}`, name: `${k}${key}`, ...over },
      });
    await proj(P.pub1, '1');
    await proj(P.pub2, '2');
    await proj(P.priv, '3', { isPrivate: true }); // chỉ owner (và admin) thấy
    await proj(P.del, '4', { deletedAt: new Date() });
    await prisma.projectMembership.create({
      data: { id: id('m1'), projectId: P.priv, userId: U.owner, roleId: id('prole') },
    });
    await prisma.program.create({
      data: { id: G.own, organizationId: WS, ownerId: U.owner, name: `Own-${TAG}` },
    });
    await prisma.program.create({
      data: { id: G.others, organizationId: WS, ownerId: U.other, name: `Other-${TAG}` },
    });
    for (const p of [P.pub1, P.pub2, P.priv, P.del])
      await prisma.projectProgram.create({ data: { projectId: p, programId: G.own } });

    const ps = prisma as unknown as PrismaService;
    class TestRbac extends RbacService {
      override projectVisibilityMode(u: string): Promise<'all' | 'standard' | 'memberOnly'> {
        return Promise.resolve(u === U.admin ? 'all' : 'standard');
      }
    }
    const rbac = new TestRbac(ps, { getClient: () => null, isAvailable: () => false } as never);
    svc = new DashboardsService(ps, new ProjectAccessService(ps, rbac));
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.dashboard.deleteMany({ where: { organizationId: WS } });
    await prisma.projectProgram.deleteMany({ where: { program: { organizationId: WS } } });
    await prisma.projectMembership.deleteMany({ where: { project: { organizationId: WS } } });
    await prisma.project.deleteMany({ where: { organizationId: WS } });
    await prisma.program.deleteMany({ where: { organizationId: WS } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId: WS } });
    await prisma.role.deleteMany({ where: { organizationId: WS } });
    await prisma.organization.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(U) } } });
    await prisma.$disconnect();
  }, 120_000);

  it('dashboard NHÓM của chủ: mỗi người xem chỉ nhận dự án của nhóm mà CHÍNH HỌ thấy; ô kế thừa theo đó', async () => {
    const d = await svc.createFromTemplate(WS, U.owner, {
      templateKey: 'project-overview',
      dataScope: 'GROUP',
      scopeProgramId: G.own,
    });
    await share(d.id);
    // Chủ thấy cả dự án riêng tư (là thành viên); dự án đã xoá luôn bị loại.
    const asOwner = await svc.get(WS, d.id, U.owner);
    expect(idsOf(asOwner)).toEqual([P.pub1, P.pub2, P.priv].sort());
    // Người xem khác chủ: dùng danh sách nhóm của chủ nhưng KHÔNG thấy dự án riêng tư.
    const asViewer = await svc.get(WS, d.id, U.viewer);
    expect(idsOf(asViewer)).toEqual([P.pub1, P.pub2].sort());
    expect(JSON.stringify(asViewer)).not.toContain(P.priv);
    for (const w of asViewer.widgets) {
      expect(w.inherits).toBe(true);
      expect([...(w.projectIds ?? [])].sort()).toEqual([P.pub1, P.pub2].sort());
    }
    // Quản trị thấy cả ba (vẫn không có dự án đã xoá).
    expect(idsOf(await svc.get(WS, d.id, U.admin))).toEqual([P.pub1, P.pub2, P.priv].sort());
    // GROUP không có BURNDOWN/VELOCITY (cần đúng một dự án).
    expect(asOwner.widgets.map((w) => w.type)).not.toContain('BURNDOWN');
    expect(asOwner.name).toBe(`Tổng quan dự án · Own-${TAG}`);
  });

  it('nhóm của người khác không dùng được (404); dự án riêng tư người gọi không thấy → 404', async () => {
    await expect(
      svc.createFromTemplate(WS, U.owner, {
        templateKey: 'qa',
        dataScope: 'GROUP',
        scopeProgramId: G.others,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      svc.createFromTemplate(WS, U.viewer, {
        templateKey: 'qa',
        dataScope: 'PROJECT',
        scopeProjectId: P.priv,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const own = await svc.createFromTemplate(WS, U.owner, {
      templateKey: 'project-overview',
      dataScope: 'PROJECT',
      scopeProjectId: P.priv,
    });
    expect(idsOf(own)).toEqual([P.priv]);
    // BURNDOWN/VELOCITY mang đúng dự án; ô khác kế thừa.
    const bound = own.widgets.filter((w) => w.type === 'BURNDOWN' || w.type === 'VELOCITY');
    expect(bound).toHaveLength(2);
    for (const w of bound) {
      expect(w.inherits).toBe(false);
      expect(w.projectIds).toEqual([P.priv]);
    }
  });

  it('dự án riêng tư trong phạm vi một dự án: người xem khác chủ nhận danh sách RỖNG (không lộ, không thành "mọi dự án")', async () => {
    const own = await svc.createFromTemplate(WS, U.owner, {
      templateKey: 'developer',
      dataScope: 'PROJECT',
      scopeProjectId: P.priv,
    });
    await share(own.id);
    const asViewer = await svc.get(WS, own.id, U.viewer);
    expect(asViewer.scopeProjects).toEqual([]);
    for (const w of asViewer.widgets) expect(w.projectIds).toEqual([]);
  });

  it('ORG chỉ cho admin tổ chức; dashboard kiểu cũ (không chọn phạm vi) = ORG, người thường vẫn tạo/sửa được', async () => {
    await expect(
      svc.createFromTemplate(WS, U.viewer, { templateKey: 'org-manager', dataScope: 'ORG' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      svc.create(WS, U.viewer, {
        name: 'X',
        scope: 'PRIVATE',
        dataScope: 'ORG',
        widgets: [],
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    const adminDash = await svc.createFromTemplate(WS, U.admin, {
      templateKey: 'org-manager',
      dataScope: 'ORG',
    });
    expect(adminDash.dataScope).toBe('ORG');
    expect(adminDash.scopeProjects).toBeNull();

    const legacy = await svc.create(WS, U.viewer, {
      name: 'Kiểu cũ',
      scope: 'PRIVATE',
      widgets: [
        {
          type: 'STAT_NUMBER',
          title: 'Mở',
          config: { metric: 'open' },
          position: { order: 0, w: 1 },
        },
      ],
    } as never);
    expect(legacy.dataScope).toBe('ORG');
    expect(legacy.scopeProjects).toBeNull();
    expect(legacy.widgets[0]).toMatchObject({ inherits: true, projectIds: null });
    // Sửa kiểu cũ (không gửi phạm vi dữ liệu) bởi người không phải admin: không 403, phạm vi giữ nguyên.
    const updated = await svc.update(WS, legacy.id, U.viewer, {
      name: 'Kiểu cũ 2',
      scope: 'PRIVATE',
      widgets: legacy.widgets.map(({ id: wid, type, title, config, position }) => ({
        id: wid,
        type,
        title,
        config,
        position,
      })),
      updatedAt: legacy.updatedAt,
    } as never);
    expect(updated.dataScope).toBe('ORG');
    // Đổi sang ORG từ phạm vi khác thì phải là admin.
    const proj = await svc.createFromTemplate(WS, U.viewer, {
      templateKey: 'blank',
      dataScope: 'PROJECT',
      scopeProjectId: P.pub1,
    });
    await expect(
      svc.update(WS, proj.id, U.viewer, {
        name: proj.name,
        scope: 'PRIVATE',
        widgets: [],
        updatedAt: proj.updatedAt,
        dataScope: 'ORG',
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('đổi phạm vi: ô kế thừa đi theo phạm vi mới, ô tự đặt dự án giữ nguyên', async () => {
    const d = await svc.createFromTemplate(WS, U.owner, {
      templateKey: 'blank',
      dataScope: 'GROUP',
      scopeProgramId: G.own,
    });
    const withOwn = await svc.update(WS, d.id, U.owner, {
      name: d.name,
      scope: 'PRIVATE',
      dataScope: 'GROUP',
      scopeProgramId: G.own,
      widgets: [
        {
          type: 'STAT_NUMBER',
          title: 'Kế thừa',
          config: { metric: 'open' },
          position: { order: 0, w: 1 },
        },
        {
          type: 'STAT_NUMBER',
          title: 'Dự án riêng',
          config: { metric: 'open', projectId: P.pub2 },
          position: { order: 1, w: 1 },
        },
      ],
      updatedAt: d.updatedAt,
    } as never);
    const before = Object.fromEntries(withOwn.widgets.map((w) => [w.title, w.projectIds]));
    expect([...(before['Kế thừa'] ?? [])].sort()).toEqual([P.pub1, P.pub2, P.priv].sort());
    expect(before['Dự án riêng']).toEqual([P.pub2]);

    const moved = await svc.update(WS, d.id, U.owner, {
      name: d.name,
      scope: 'PRIVATE',
      dataScope: 'PROJECT',
      scopeProjectId: P.pub1,
      widgets: withOwn.widgets.map(({ id: wid, type, title, config, position }) => ({
        id: wid,
        type,
        title,
        config,
        position,
      })),
      updatedAt: withOwn.updatedAt,
    } as never);
    expect(moved.dataScope).toBe('PROJECT');
    expect(moved.scopeProgramId).toBeNull();
    const after = Object.fromEntries(moved.widgets.map((w) => [w.title, w.projectIds]));
    expect(after['Kế thừa']).toEqual([P.pub1]);
    expect(after['Dự án riêng']).toEqual([P.pub2]);
  });

  it('nhóm bị xoá: scopeProgramId về null, danh sách RỖNG (không rơi về "mọi dự án"), sửa không gửi phạm vi vẫn giữ nguyên', async () => {
    const g = await prisma.program.create({
      data: { id: id('gtmp'), organizationId: WS, ownerId: U.owner, name: `Tmp-${TAG}` },
    });
    await prisma.projectProgram.create({ data: { projectId: P.pub1, programId: g.id } });
    const d = await svc.createFromTemplate(WS, U.owner, {
      templateKey: 'qa',
      dataScope: 'GROUP',
      scopeProgramId: g.id,
    });
    expect(idsOf(d)).toEqual([P.pub1]);
    await prisma.program.delete({ where: { id: g.id } });
    const gone = await svc.get(WS, d.id, U.owner);
    expect(gone.dataScope).toBe('GROUP');
    expect(gone.scopeProgramId).toBeNull();
    expect(gone.scopeProjects).toEqual([]);
    const renamed = await svc.update(WS, d.id, U.owner, {
      name: 'Đổi tên',
      scope: 'PRIVATE',
      widgets: gone.widgets.map(({ id: wid, type, title, config, position }) => ({
        id: wid,
        type,
        title,
        config,
        position,
      })),
      updatedAt: gone.updatedAt,
    } as never);
    expect(renamed.dataScope).toBe('GROUP');
    expect(renamed.scopeProjects).toEqual([]);
  });

  it('nhân bản dashboard nhóm của người khác: bản sao KHÔNG mang nhóm riêng của họ (về ORG)', async () => {
    const d = await svc.createFromTemplate(WS, U.owner, {
      templateKey: 'blank',
      dataScope: 'GROUP',
      scopeProgramId: G.own,
    });
    await share(d.id);
    const copy = await svc.duplicate(WS, d.id, U.viewer);
    expect(copy.dataScope).toBe('ORG');
    expect(copy.scopeProgramId).toBeNull();
    const mine = await svc.duplicate(WS, d.id, U.owner);
    expect(mine.dataScope).toBe('GROUP');
    expect(mine.scopeProgramId).toBe(G.own);
  });

  it('migration: bản ghi dashboard có sẵn (chưa có cột) nhận ORG và id phạm vi null', async () => {
    const row = await prisma.dashboard.create({
      data: { organizationId: WS, ownerId: U.owner, name: 'Cũ' },
    });
    expect(row.dataScope).toBe('ORG');
    expect(row.scopeProjectId).toBeNull();
    expect(row.scopeProgramId).toBeNull();
  });
});
