import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../rbac/permissions.guard';
import type { RbacService } from '../rbac/rbac.service';
import { RulesController } from './rules.controller';

const proto = RulesController.prototype;

describe('RulesController — mọi route gác automation:manage theo dự án', () => {
  const handlers = ['list', 'get', 'create', 'update', 'remove', 'runs', 'test'] as const;
  it.each(handlers)('%s: cần automation:manage và có @ProjectRef', (name) => {
    const h = proto[name];
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.AUTOMATION_MANAGE]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toBeDefined();
  });
  it('list đọc projectId từ query, create từ body', () => {
    expect(Reflect.getMetadata(PROJECT_REF_KEY, proto.list)).toEqual({
      kind: 'query',
      param: 'projectId',
    });
    expect(Reflect.getMetadata(PROJECT_REF_KEY, proto.create)).toEqual({
      kind: 'body',
      param: 'projectId',
    });
  });
});

describe('RulesController.list — guard thật (người chỉ quản trị MỘT dự án vào từ menu Thêm)', () => {
  /** Chỉ có automation:manage ở dự án p1 (vai trò dự án), không có ở cấp workspace. */
  function setup(query: Record<string, string>) {
    const rbac = {
      getEffectivePermissions: vi.fn((_u: string, _w: string, projectId?: string | null) =>
        Promise.resolve(new Set<string>(projectId === 'p1' ? [PERMISSIONS.AUTOMATION_MANAGE] : [])),
      ),
      resolveProjectId: vi.fn(),
      assertProjectInWorkspace: vi.fn(() => Promise.resolve()),
      assertProjectVisible: vi.fn(() => Promise.resolve()),
    };
    const guard = new PermissionsGuard(new Reflector(), rbac as unknown as RbacService);
    const req = { user: { id: 'U1', workspaceId: 'w1', isSystemAdmin: false }, params: {}, query };
    const ctx = {
      getHandler: () => proto.list,
      getClass: () => RulesController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { guard, ctx };
  }

  it('dự án mình quản trị => cho qua', async () => {
    const { guard, ctx } = setup({ projectId: 'p1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
  it('dự án khác => 403', async () => {
    const { guard, ctx } = setup({ projectId: 'p2' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenAppException);
  });
  it('không truyền projectId (xem tất cả quy tắc workspace) => 403', async () => {
    const { guard, ctx } = setup({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenAppException);
  });
});
