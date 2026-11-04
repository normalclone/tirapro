import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { WorkflowAdminController } from './workflow-admin.controller';

/**
 * Ai sửa được quy trình: Quản trị dự án A sửa quy trình/trạng thái/bước chuyển CỦA dự án A; không sửa của dự án B và không sửa quy
 * trình chung (chỉ Quản trị chung). Chạy PermissionsGuard THẬT với metadata thật của từng route + controller thật.
 */
const OWNER: Record<string, string | null> = {
  wA: 'A',
  wB: 'B',
  wS: null,
  sA: 'A',
  sB: 'B',
  sS: null,
  tA: 'A',
  tB: 'B',
  tS: null,
};

const ROUTES: Array<{
  name: keyof WorkflowAdminController;
  ids: [string, string, string]; // dự án A, dự án B, chung
  args: (id: string) => unknown[]; // sau (organizationId, user)
}> = [
  { name: 'update', ids: ['wA', 'wB', 'wS'], args: (id) => [id, { name: 'Tên mới' }] },
  {
    name: 'createStatus',
    ids: ['wA', 'wB', 'wS'],
    args: (id) => [id, { name: 'S', category: 'TODO' }],
  },
  { name: 'updateStatus', ids: ['sA', 'sB', 'sS'], args: (id) => [id, { name: 'S2' }] },
  { name: 'removeStatus', ids: ['sA', 'sB', 'sS'], args: (id) => [id, undefined] },
  {
    name: 'createTransition',
    ids: ['wA', 'wB', 'wS'],
    args: (id) => [id, { name: 'T', toStatusId: 'x' }],
  },
  { name: 'updateTransition', ids: ['tA', 'tB', 'tS'], args: (id) => [id, { name: 'T2' }] },
  { name: 'removeTransition', ids: ['tA', 'tB', 'tS'], args: (id) => [id] },
];

function build() {
  const service = {
    ownerProjectId: vi.fn((_w: string, _k: string, id: string) =>
      Promise.resolve(OWNER[id] ?? null),
    ),
    updateWorkflow: vi.fn(() => Promise.resolve({})),
    createStatus: vi.fn(() => Promise.resolve({})),
    updateStatus: vi.fn(() => Promise.resolve({})),
    removeStatus: vi.fn(() => Promise.resolve({})),
    createTransition: vi.fn(() => Promise.resolve({})),
    updateTransition: vi.fn(() => Promise.resolve({})),
    removeTransition: vi.fn(() => Promise.resolve({})),
  };
  const controller = new WorkflowAdminController(service as never);
  const rbac = {
    resolveProjectId: vi.fn((_w: string, _kind: string, id: string) =>
      Promise.resolve({ projectId: OWNER[id] ?? null }),
    ),
    assertProjectVisible: vi.fn(() => Promise.resolve()),
    assertProjectInOrganization: vi.fn(() => Promise.resolve()),
    getEffectivePermissions: vi.fn(),
  };
  const guard = new PermissionsGuard(new Reflector(), rbac as never);
  return { controller, service, rbac, guard };
}

type Who = {
  id: string;
  effective: (projectId: string | null) => string[];
  isSystemAdmin?: boolean;
};
const paA: Who = {
  id: 'paA',
  effective: (p) => (p === 'A' ? ['project:view', 'project:admin'] : ['project:view']),
};
const wsAdmin: Who = {
  id: 'wa',
  effective: () => ['project:view', 'project:admin', 'organization:admin'],
};
/** Vai tuỳ biến mang `project:admin` ở cấp tổ chức nhưng KHÔNG phải Quản trị chung. */
const orgProjectAdmin: Who = { id: 'cust', effective: () => ['project:view', 'project:admin'] };

async function run(who: Who, route: (typeof ROUTES)[number], id: string) {
  const { controller, rbac, guard } = build();
  rbac.getEffectivePermissions.mockImplementation((_u: string, _w: string, p: string | null) =>
    Promise.resolve(new Set(who.effective(p))),
  );
  const handler = WorkflowAdminController.prototype[route.name] as (...a: never[]) => unknown;
  const user: Record<string, unknown> = {
    id: who.id,
    organizationId: 'W1',
    isSystemAdmin: !!who.isSystemAdmin,
  };
  const req = { user, params: { id }, query: {}, body: {} };
  const ctx = {
    getHandler: () => handler,
    getClass: () => WorkflowAdminController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  await guard.canActivate(ctx); // ném khi guard chặn
  await (controller[route.name] as (...a: unknown[]) => Promise<unknown>)(
    'W1',
    user,
    ...route.args(id),
  );
}

describe('Sửa quy trình: ai được phép (guard thật + kiểm sở hữu)', () => {
  for (const route of ROUTES) {
    describe(String(route.name), () => {
      const [ownA, ownB, shared] = route.ids;
      it('Quản trị dự án A sửa được quy trình của chính dự án A', async () => {
        await expect(run(paA, route, ownA)).resolves.toBeUndefined();
      });
      it('Quản trị dự án A KHÔNG sửa được quy trình của dự án B', async () => {
        await expect(run(paA, route, ownB)).rejects.toMatchObject({ status: 403 });
      });
      it('Quản trị dự án A KHÔNG sửa được quy trình chung của tổ chức', async () => {
        await expect(run(paA, route, shared)).rejects.toMatchObject({ status: 403 });
      });
      it('vai tuỳ biến có project:admin cấp tổ chức vẫn KHÔNG sửa được quy trình chung (cần Quản trị chung)', async () => {
        await expect(run(orgProjectAdmin, route, shared)).rejects.toMatchObject({ status: 403 });
      });
      it('Quản trị chung sửa được cả quy trình chung lẫn của mọi dự án', async () => {
        await expect(run(wsAdmin, route, shared)).resolves.toBeUndefined();
        await expect(run(wsAdmin, route, ownB)).resolves.toBeUndefined();
      });
    });
  }

  it('route khai báo đúng loại tài nguyên để guard tra dự án sở hữu', () => {
    const reflect = (name: keyof WorkflowAdminController) =>
      Reflect.getMetadata('projectRef', WorkflowAdminController.prototype[name]) as {
        kind: string;
      };
    expect(reflect('update').kind).toBe('workflow');
    expect(reflect('updateStatus').kind).toBe('workflowStatus');
    expect(reflect('removeTransition').kind).toBe('workflowTransition');
  });

  it('đặt quy trình mặc định (isDefault) chỉ Quản trị chung, kể cả trên quy trình của dự án mình', async () => {
    const { controller } = build();
    const user = {
      id: 'paA',
      organizationId: 'W1',
      isSystemAdmin: false,
      permissions: ['project:admin'],
    };
    await expect(
      controller.update('W1', user as never, 'wA', { isDefault: true }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.update('W1', user as never, 'wA', { name: 'Tên mới' }),
    ).resolves.toBeDefined();
  });
});
