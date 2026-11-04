import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import type { RbacService } from '../rbac/rbac.service';
import { WorkflowSchemeController } from './workflow-scheme.controller';
import type { WorkflowSchemeService } from './workflow-scheme.service';

const proto = WorkflowSchemeController.prototype;

describe('WorkflowSchemeController — metadata quyền', () => {
  it('cấu hình của tổ chức (GET/PUT workflow-schemes): workspace:admin', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.getScheme)).toEqual([
      PERMISSIONS.WORKSPACE_ADMIN,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.setScheme)).toEqual([
      PERMISSIONS.WORKSPACE_ADMIN,
    ]);
  });
  it('ghi đè dự án (PUT/DELETE): project:admin theo :id của dự án; xem: project:view', () => {
    for (const h of [proto.setOverride, proto.clearOverride]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.PROJECT_ADMIN]);
      expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'param', param: 'id' });
    }
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.getProjectScheme)).toEqual([
      PERMISSIONS.PROJECT_VIEW,
    ]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, proto.getProjectScheme)).toEqual({
      kind: 'param',
      param: 'id',
    });
  });
});

describe('WorkflowSchemeController — guard thật: ai được gọi (403 cho người còn lại)', () => {
  /** Vai trò → quyền hiệu lực (vai trò workspace gồm cả quyền dự án; vai trò dự án chỉ có ở dự án p1). */
  function run(handler: (...a: never[]) => unknown, perms: string[], isSystemAdmin = false) {
    const rbac = {
      getEffectivePermissions: vi.fn(() => Promise.resolve(new Set<string>(perms))),
      resolveProjectId: vi.fn(),
      assertProjectInWorkspace: vi.fn(() => Promise.resolve()),
      assertProjectVisible: vi.fn(() => Promise.resolve()),
    };
    const guard = new PermissionsGuard(new Reflector(), rbac as unknown as RbacService);
    const req = {
      user: { id: 'U1', workspaceId: 'w1', isSystemAdmin },
      params: { id: 'p1' },
      query: {},
      body: {},
    };
    const ctx = {
      getHandler: () => handler,
      getClass: () => WorkflowSchemeController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return guard.canActivate(ctx);
  }
  const perms = (role: (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]) =>
    SYSTEM_ROLE_PERMISSIONS[role];

  it.each([
    ['Workspace Admin', perms(SYSTEM_ROLES.WORKSPACE_ADMIN), true],
    ['Project Admin', perms(SYSTEM_ROLES.PROJECT_ADMIN), false],
    ['Developer', perms(SYSTEM_ROLES.DEVELOPER), false],
    ['Workspace Member', perms(SYSTEM_ROLES.WORKSPACE_MEMBER), false],
  ])('workflow-schemes (tổ chức) — %s', async (_n, p, allowed) => {
    for (const h of [proto.getScheme, proto.setScheme]) {
      if (allowed) await expect(run(h, p)).resolves.toBe(true);
      else await expect(run(h, p)).rejects.toMatchObject({ status: 403 });
    }
  });

  it('SA luôn được gọi (kể cả không có quyền nào)', async () => {
    for (const h of [proto.getScheme, proto.setScheme, proto.setOverride, proto.clearOverride])
      await expect(run(h, [], true)).resolves.toBe(true);
  });

  it.each([
    ['Workspace Admin', perms(SYSTEM_ROLES.WORKSPACE_ADMIN), true],
    ['Project Admin', perms(SYSTEM_ROLES.PROJECT_ADMIN), true],
    ['Developer', perms(SYSTEM_ROLES.DEVELOPER), false],
    ['Workspace Member', perms(SYSTEM_ROLES.WORKSPACE_MEMBER), false],
  ])('ghi đè dự án (PUT/DELETE) — %s', async (_n, p, allowed) => {
    for (const h of [proto.setOverride, proto.clearOverride]) {
      if (allowed) await expect(run(h, p)).resolves.toBe(true);
      else await expect(run(h, p)).rejects.toMatchObject({ status: 403 });
    }
  });

  it('mọi vai trò có project:view đều XEM được quy trình hiệu lực của dự án', async () => {
    await expect(run(proto.getProjectScheme, perms(SYSTEM_ROLES.DEVELOPER))).resolves.toBe(true);
  });
});

describe('WorkflowSchemeController — truyền tham số', () => {
  function build() {
    const schemes = {
      setWorkspaceScheme: vi.fn(() => Promise.resolve({})),
      setProjectOverride: vi.fn(() => Promise.resolve({})),
      clearProjectOverride: vi.fn(() => Promise.resolve({})),
    };
    return {
      schemes,
      c: new WorkflowSchemeController(schemes as unknown as WorkflowSchemeService),
    };
  }
  const user = { id: 'U1' } as never;

  it('?dryRun=1 / true bật xem trước; vắng hoặc giá trị khác thì chạy thật', async () => {
    const { schemes, c } = build();
    const dto = { items: [], statusMap: undefined } as never;
    await c.setScheme('w1', user, dto, '1');
    await c.setScheme('w1', user, dto, 'true');
    await c.setScheme('w1', user, dto, undefined);
    await c.setScheme('w1', user, dto, '0');
    expect(schemes.setWorkspaceScheme.mock.calls.map((x) => (x as unknown[])[3])).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('DELETE chuyển issueTypeId + statusMap và cờ dryRun', async () => {
    const { schemes, c } = build();
    await c.clearOverride('w1', user, 'p1', 'tBug', { statusMap: { a: 'b' } }, '1');
    expect(schemes.clearProjectOverride).toHaveBeenCalledWith(
      'w1',
      'p1',
      'U1',
      'tBug',
      { a: 'b' },
      true,
    );
  });
});
