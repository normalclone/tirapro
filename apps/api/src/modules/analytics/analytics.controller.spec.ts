import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import {
  BusinessRuleException,
  ForbiddenAppException,
} from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RbacService } from '../rbac/rbac.service';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';
import type { QaReportService } from './qa-report.service';

describe('AnalyticsController.burndown — metadata', () => {
  const h = AnalyticsController.prototype.burndown;
  it('kiểm report:view theo dự án (query projectId), không chỉ theo workspace', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'query', param: 'projectId' });
  });
});

describe('AnalyticsController.sprintSummary — metadata', () => {
  const h = AnalyticsController.prototype.sprintSummary;
  it('cùng khuôn quyền với burndown: report:view theo dự án (query projectId)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'query', param: 'projectId' });
  });
  it('thiếu projectId hoặc sprintId => lỗi nghiệp vụ', async () => {
    const analytics = { sprintSummary: vi.fn() };
    const controller = new AnalyticsController(
      analytics as unknown as AnalyticsService,
      {} as unknown as QaReportService,
    );
    await expect(controller.sprintSummary('w1', 'sp1', undefined)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    await expect(controller.sprintSummary('w1', undefined, 'p1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(analytics.sprintSummary).not.toHaveBeenCalled();
  });
});

describe('AnalyticsController.burndown — guard thật + controller', () => {
  /** Member: KHÔNG có report:view ở cấp workspace, chỉ có ở dự án p1 (vai trò dự án Developer). */
  function setup(query: Record<string, string>) {
    const rbac = {
      getEffectivePermissions: vi.fn((_u: string, _w: string, projectId?: string | null) =>
        Promise.resolve(new Set<string>(projectId === 'p1' ? [PERMISSIONS.REPORT_VIEW] : [])),
      ),
      resolveProjectId: vi.fn(),
      assertProjectInWorkspace: vi.fn(() => Promise.resolve()),
      assertProjectVisible: vi.fn(() => Promise.resolve()),
    };
    const guard = new PermissionsGuard(new Reflector(), rbac as unknown as RbacService);
    const analytics = { burndown: vi.fn(() => Promise.resolve({ sprintId: 'sp1' })) };
    const controller = new AnalyticsController(
      analytics as unknown as AnalyticsService,
      {} as unknown as QaReportService,
    );
    const req = { user: { id: 'U1', workspaceId: 'w1', isSystemAdmin: false }, params: {}, query };
    const ctx = {
      getHandler: () => AnalyticsController.prototype.burndown,
      getClass: () => AnalyticsController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { guard, controller, rbac, analytics, ctx };
  }

  it('member có report:view ở dự án (không có ở workspace) => guard cho qua và service nhận đủ workspace/dự án/sprint (200, không 403)', async () => {
    const { guard, controller, rbac, analytics, ctx } = setup({ projectId: 'p1', sprintId: 'sp1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(rbac.assertProjectInWorkspace).toHaveBeenCalledWith('p1', 'w1');
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'w1', 'p1');
    await controller.burndown('w1', 'sp1', 'p1');
    expect(analytics.burndown).toHaveBeenCalledWith('w1', 'p1', 'sp1');
  });

  it('cùng member nhưng dự án khác không có quyền => 403 (quyền tính theo dự án, không rò sang dự án khác)', async () => {
    const { guard, ctx } = setup({ projectId: 'p2', sprintId: 'sp1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('thiếu projectId => guard chỉ tính quyền workspace (member bị 403); controller cũng từ chối nếu lọt tới', async () => {
    const { guard, controller, ctx } = setup({ sprintId: 'sp1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenAppException);
    await expect(controller.burndown('w1', 'sp1', undefined)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('thiếu sprintId => BusinessRule, không gọi service', async () => {
    const { controller, analytics } = setup({ projectId: 'p1' });
    await expect(controller.burndown('w1', undefined, 'p1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(analytics.burndown).not.toHaveBeenCalled();
  });
});

describe('AnalyticsController.qa — metadata', () => {
  const h = AnalyticsController.prototype.qa;
  it('kiểm report:view theo dự án (query projectId)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'query', param: 'projectId' });
  });
  it('thiếu projectId => lỗi nghiệp vụ; đủ thì chuyển cho service', async () => {
    const qaReport = { report: vi.fn(() => Promise.resolve({})) };
    const controller = new AnalyticsController(
      {} as unknown as AnalyticsService,
      qaReport as unknown as QaReportService,
    );
    await expect(controller.qa('w1', undefined)).rejects.toBeInstanceOf(BusinessRuleException);
    await controller.qa('w1', 'p1', '2026-10-01', '2026-10-15');
    expect(qaReport.report).toHaveBeenCalledWith('w1', 'p1', '2026-10-01', '2026-10-15');
  });
});

describe('AnalyticsController.qa — guard thật', () => {
  const handler = AnalyticsController.prototype.qa;
  const ctxOf = (query: Record<string, string>) =>
    ({
      getHandler: () => handler,
      getClass: () => AnalyticsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'U1', workspaceId: 'w1', isSystemAdmin: false },
          params: {},
          query,
          body: {},
        }),
      }),
    }) as unknown as ExecutionContext;

  /** RbacService THẬT trên Prisma giả: dự án tồn tại hay không, riêng tư hay không, người gọi có phải thành viên không. */
  async function run(sc: 'missing' | 'private-outsider') {
    const hidden = sc === 'private-outsider';
    const prisma = {
      project: {
        findFirst: vi.fn((args: { where: Record<string, unknown> }) => {
          if (args.where.isPrivate === true) return Promise.resolve({ memberships: [] });
          return Promise.resolve(hidden ? { id: 'P1' } : null);
        }),
      },
      workspaceMembership: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            roleId: 'r',
            roles: [{ role: { id: 'r', name: 'Workspace Member' } }],
          }),
        ),
      },
      rolePermission: {
        findMany: vi.fn(() => Promise.resolve([{ permission: { key: PERMISSIONS.REPORT_VIEW } }])),
      },
      role: { findMany: vi.fn(() => Promise.resolve([])) },
      projectMembership: { findUnique: vi.fn(() => Promise.resolve(null)) },
    };
    const rbac = new RbacService(
      prisma as never,
      { getClient: () => null, isAvailable: () => false } as never,
    );
    const guard = new PermissionsGuard(new Reflector(), rbac);
    try {
      await guard.canActivate(ctxOf({ projectId: 'P1' }));
    } catch (e) {
      const ex = e as { getStatus(): number; getResponse(): unknown };
      return { status: ex.getStatus(), body: ex.getResponse() };
    }
    throw new Error('guard không ném lỗi');
  }

  it('dự án riêng tư người ngoài => 404 GIỐNG HỆT dự án không tồn tại (không lộ sự tồn tại)', async () => {
    const missing = await run('missing');
    const hidden = await run('private-outsider');
    expect(missing.status).toBe(404);
    expect(hidden).toEqual(missing);
  });

  it('thiếu report:view ở dự án => 403; có report:view ở dự án => cho qua và service nhận đủ tham số', async () => {
    const mk = (perms: string[]) => {
      const rbac = {
        getEffectivePermissions: vi.fn(() => Promise.resolve(new Set<string>(perms))),
        resolveProjectId: vi.fn(),
        assertProjectInWorkspace: vi.fn(() => Promise.resolve()),
        assertProjectVisible: vi.fn(() => Promise.resolve()),
      };
      return new PermissionsGuard(new Reflector(), rbac as unknown as RbacService);
    };
    await expect(mk([]).canActivate(ctxOf({ projectId: 'p1' }))).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
    await expect(
      mk([PERMISSIONS.REPORT_VIEW]).canActivate(ctxOf({ projectId: 'p1' })),
    ).resolves.toBe(true);
  });
});
