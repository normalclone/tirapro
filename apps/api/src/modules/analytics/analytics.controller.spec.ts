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
import type { RbacService } from '../rbac/rbac.service';
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
