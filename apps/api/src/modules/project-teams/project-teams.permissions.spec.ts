import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { ProjectTeamsController } from './project-teams.controller';

/**
 * Ai gắn / gỡ team của dự án: chỉ Quản trị dự án CỦA DỰ ÁN ĐÓ hoặc Quản trị chung; thành viên thường chỉ xem. Chạy PermissionsGuard
 * THẬT với metadata thật của từng route + controller thật (quyền tính theo `:projectId`, không tin query/body).
 */
type Who = { id: string; effective: (projectId: string | null) => string[]; invisibleB?: boolean };
const paA: Who = {
  id: 'paA',
  effective: (p) => (p === 'A' ? ['project:view', 'project:admin'] : ['project:view']),
};
const memberA: Who = {
  id: 'mA',
  effective: (p) => (p === 'A' ? ['project:view', 'issue:edit'] : []),
};
const teamManager: Who = {
  id: 'tm',
  // team:manage (cấp tổ chức) KHÔNG đủ để gắn team vào dự án: cần project:admin của dự án
  effective: () => ['project:view', 'team:manage'],
};
const orgAdmin: Who = {
  id: 'oa',
  effective: () => ['project:view', 'project:admin', 'team:manage', 'organization:admin'],
};

const ROUTES = [
  { name: 'list', method: 'GET', args: () => [] as unknown[], needsAdmin: false },
  { name: 'link', method: 'PUT', args: () => ['T1', { roleIds: ['r1'] }], needsAdmin: true },
  { name: 'unlink', method: 'DELETE', args: () => ['T1'], needsAdmin: true },
] as const;

async function run(who: Who, route: (typeof ROUTES)[number], projectId: string) {
  const service = {
    list: vi.fn(() => Promise.resolve([])),
    link: vi.fn(() => Promise.resolve([])),
    unlink: vi.fn(() => Promise.resolve([])),
  };
  const controller = new ProjectTeamsController(service as never);
  const rbac = {
    resolveProjectId: vi.fn(),
    assertProjectVisible: vi.fn(() => Promise.resolve()),
    assertProjectInOrganization: vi.fn(() => Promise.resolve()),
    getEffectivePermissions: vi.fn((_u: string, _w: string, p: string | null) => {
      if (p === 'B' && who.invisibleB) return Promise.reject(new NotFoundAppException('Dự án'));
      return Promise.resolve(new Set(who.effective(p)));
    }),
  };
  const guard = new PermissionsGuard(new Reflector(), rbac as never);
  const handler = ProjectTeamsController.prototype[route.name] as (...a: never[]) => unknown;
  const user = { id: who.id, organizationId: 'W1', isSystemAdmin: false };
  const req = { user, params: { projectId }, query: {}, body: {} };
  const ctx = {
    getHandler: () => handler,
    getClass: () => ProjectTeamsController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  await guard.canActivate(ctx);
  await (controller[route.name] as (...a: unknown[]) => Promise<unknown>)(
    ...(route.name === 'list' ? ['W1', projectId] : [user, 'W1', projectId, ...route.args()]),
  );
  return service;
}

describe('Team của dự án: ai được phép (guard thật)', () => {
  for (const route of ROUTES) {
    describe(`${route.method} ${route.name}`, () => {
      it('Quản trị dự án A thao tác được trên dự án A', async () => {
        await expect(run(paA, route, 'A')).resolves.toBeTruthy();
      });
      it(
        route.needsAdmin
          ? 'Quản trị dự án A KHÔNG gắn/gỡ được team của dự án B (chỉ xem)'
          : 'Quản trị dự án A vẫn xem được dự án B vì có project:view',
        async () => {
          if (route.needsAdmin)
            await expect(run(paA, route, 'B')).rejects.toMatchObject({ status: 403 });
          else await expect(run(paA, route, 'B')).resolves.toBeTruthy();
        },
      );
      it('Quản trị thao tác được ở mọi dự án', async () => {
        await expect(run(orgAdmin, route, 'B')).resolves.toBeTruthy();
      });
      if (route.needsAdmin) {
        it('thành viên thường của dự án KHÔNG gắn/gỡ được', async () => {
          await expect(run(memberA, route, 'A')).rejects.toMatchObject({ status: 403 });
        });
        it('team:manage một mình (cấp tổ chức) KHÔNG đủ để gắn/gỡ team vào dự án', async () => {
          await expect(run(teamManager, route, 'A')).rejects.toMatchObject({ status: 403 });
        });
      }
      it('dự án riêng tư người gọi không thấy → 404, không gọi service', async () => {
        await expect(run({ ...paA, invisibleB: true }, route, 'B')).rejects.toMatchObject({
          status: 404,
        });
      });
    });
  }

  it('route khai báo đúng quyền', () => {
    const perms = (n: keyof ProjectTeamsController) =>
      Reflect.getMetadata('requiredPermissions', ProjectTeamsController.prototype[n]) as
        | string[]
        | undefined;
    expect(perms('list')).toEqual(['project:view']);
    expect(perms('link')).toEqual(['project:admin']);
    expect(perms('unlink')).toEqual(['project:admin']);
  });
});
