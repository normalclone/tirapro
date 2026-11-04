import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import {
  PROJECT_REF_KEY,
  type ProjectRefMeta,
} from '../../common/decorators/project-ref.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from './permissions.guard';

/** Hợp đồng của `@PermissionsAnyOf` ở chính guard: VÀ với `@Permissions`, `:own`, mảng rỗng, dự án của route. */
function setup(opts: {
  required?: string[];
  anyOf?: string[];
  ref?: ProjectRefMeta;
  effective: string[];
  isSystemAdmin?: boolean;
}) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === PERMISSIONS_KEY) return opts.required;
      if (key === PERMISSIONS_ANY_KEY) return opts.anyOf;
      if (key === PROJECT_REF_KEY) return opts.ref;
      return undefined;
    }),
  };
  const rbac = {
    getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(opts.effective))),
    resolveProjectId: vi.fn(() => Promise.resolve({ projectId: 'P1' })),
    assertProjectVisible: vi.fn(() => Promise.resolve()),
    assertProjectInWorkspace: vi.fn(() => Promise.resolve()),
  };
  const req = {
    user: { id: 'U1', workspaceId: 'W1', isSystemAdmin: opts.isSystemAdmin ?? false },
    params: { id: 'X1' },
    body: {},
    query: {},
    ownOnly: undefined as Set<string> | undefined,
  };
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  };
  const guard = new PermissionsGuard(reflector as never, rbac as never);
  return { guard, rbac, req, ctx: ctx as unknown as ExecutionContext };
}

describe('PermissionsGuard — @PermissionsAnyOf', () => {
  it('chỉ có anyOf: có ÍT NHẤT một quyền là qua; không có quyền nào → 403', async () => {
    const ok = setup({ anyOf: ['goal:manage', 'project:admin'], effective: ['project:admin'] });
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);
    const org = setup({ anyOf: ['goal:manage', 'project:admin'], effective: ['goal:manage'] });
    await expect(org.guard.canActivate(org.ctx)).resolves.toBe(true);
    const none = setup({ anyOf: ['goal:manage', 'project:admin'], effective: ['project:view'] });
    await expect(none.guard.canActivate(none.ctx)).rejects.toBeInstanceOf(ForbiddenAppException);
  });

  it('VÀ với @Permissions: phải đạt CẢ quyền bắt buộc lẫn một quyền trong anyOf', async () => {
    const cfg = { required: ['workspace:view'], anyOf: ['goal:manage', 'project:admin'] };
    const both = setup({ ...cfg, effective: ['workspace:view', 'project:admin'] });
    await expect(both.guard.canActivate(both.ctx)).resolves.toBe(true);
    const onlyRequired = setup({ ...cfg, effective: ['workspace:view'] });
    await expect(onlyRequired.guard.canActivate(onlyRequired.ctx)).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
    const onlyAny = setup({ ...cfg, effective: ['project:admin'] });
    await expect(onlyAny.guard.canActivate(onlyAny.ctx)).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });

  it('`:own` thoả @Permissions (như cũ, đánh dấu ownOnly) nhưng KHÔNG thoả anyOf, và anyOf không vào ownOnly', async () => {
    const own = setup({
      required: ['issue:edit'],
      anyOf: ['project:admin'],
      effective: ['issue:edit:own', 'project:admin'],
    });
    await expect(own.guard.canActivate(own.ctx)).resolves.toBe(true);
    expect([...own.req.ownOnly!]).toEqual(['issue:edit']); // chỉ quyền bắt buộc; project:admin đầy đủ nên không đánh dấu

    const ownAny = setup({ anyOf: ['project:admin'], effective: ['project:admin:own'] });
    await expect(ownAny.guard.canActivate(ownAny.ctx)).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });

  it('mảng rỗng: anyOf rỗng + có @Permissions → chỉ xét quyền bắt buộc; cả hai rỗng → không kiểm gì (rbac-coverage chặn khai báo kiểu này)', async () => {
    const reqOnly = setup({
      required: ['workspace:view'],
      anyOf: [],
      effective: ['workspace:view'],
    });
    await expect(reqOnly.guard.canActivate(reqOnly.ctx)).resolves.toBe(true);
    const lacking = setup({ required: ['workspace:view'], anyOf: [], effective: [] });
    await expect(lacking.guard.canActivate(lacking.ctx)).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
    const empty = setup({ anyOf: [], effective: [] });
    await expect(empty.guard.canActivate(empty.ctx)).resolves.toBe(true);
    expect(empty.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('quyền hiệu lực tính theo dự án của route (@ProjectRef), nên project:admin chỉ có giá trị ở dự án đó', async () => {
    const t = setup({
      anyOf: ['project:admin'],
      ref: { kind: 'objective', param: 'id' },
      effective: ['project:admin'],
    });
    await t.guard.canActivate(t.ctx);
    expect(t.rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', 'P1');
  });

  it('system admin được miễn', async () => {
    const t = setup({ anyOf: ['goal:manage'], effective: [], isSystemAdmin: true });
    await expect(t.guard.canActivate(t.ctx)).resolves.toBe(true);
  });
});
