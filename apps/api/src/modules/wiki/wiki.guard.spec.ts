import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { WikiController } from './wiki.controller';

/**
 * Guard THẬT (Reflector thật + metadata thật của WikiController): quyền wiki tính theo dự án CỦA TRANG,
 * không theo dự án client tự khai (A8).
 */
function run(opts: {
  handler: keyof WikiController;
  req: Record<string, unknown>;
  pageProject?: string | null;
  perms: Record<string, string[]>; // projectId ('-' = cấp workspace) → quyền hiệu lực
}) {
  const rbac = {
    getEffectivePermissions: vi.fn((_u: string, _w: string, p?: string | null) =>
      Promise.resolve(new Set(opts.perms[p ?? '-'] ?? [])),
    ),
    resolveProjectId: vi.fn(() => Promise.resolve({ projectId: opts.pageProject ?? null })),
    assertProjectInWorkspace: vi.fn(() => Promise.resolve()),
  };
  const guard = new PermissionsGuard(
    new Reflector(),
    rbac as unknown as ConstructorParameters<typeof PermissionsGuard>[1],
  );
  const ctx = {
    getHandler: () => WikiController.prototype[opts.handler],
    getClass: () => WikiController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 'U1', workspaceId: 'W1', isSystemAdmin: false },
        ...opts.req,
      }),
    }),
  } as unknown as ExecutionContext;
  return { allowed: guard.canActivate(ctx), rbac };
}

describe('PermissionsGuard × WikiController (A8)', () => {
  const perms = { P: ['wiki:manage'], Q: [], '-': [] };

  it('PUT trang của dự án Q khi chỉ có wiki:manage ở dự án P → 403', async () => {
    const { allowed, rbac } = run({
      handler: 'update',
      req: { params: { id: 'page-Q' }, body: { projectId: 'P' } }, // body.projectId KHÔNG lái được
      pageProject: 'Q',
      perms,
    });
    await expect(allowed).rejects.toMatchObject({ status: 403 });
    expect(rbac.resolveProjectId).toHaveBeenCalledWith('W1', 'wikiPage', 'page-Q');
  });

  it('PUT trang của dự án P → được', async () => {
    const { allowed } = run({
      handler: 'update',
      req: { params: { id: 'page-P' } },
      pageProject: 'P',
      perms,
    });
    await expect(allowed).resolves.toBe(true);
  });

  it('PUT/move trang chung (projectId null) với quyền dự án P → 403 (cần quyền cấp workspace)', async () => {
    for (const handler of ['update', 'move'] as const) {
      const { allowed } = run({
        handler,
        req: { params: { id: 'page-shared' } },
        pageProject: null,
        perms,
      });
      await expect(allowed).rejects.toMatchObject({ status: 403 });
    }
  });

  it('POST theo body.projectId: có quyền ở P tạo được ở P, không tạo được ở Q', async () => {
    const ok = run({ handler: 'create', req: { params: {}, body: { projectId: 'P' } }, perms });
    await expect(ok.allowed).resolves.toBe(true);
    const no = run({ handler: 'create', req: { params: {}, body: { projectId: 'Q' } }, perms });
    await expect(no.allowed).rejects.toMatchObject({ status: 403 });
  });

  it('DELETE đòi project:admin: wiki:manage không đủ, quản trị dự án thì được', async () => {
    const dev = run({
      handler: 'remove',
      req: { params: { id: 'page-P' } },
      pageProject: 'P',
      perms,
    });
    await expect(dev.allowed).rejects.toMatchObject({ status: 403 });
    const admin = run({
      handler: 'remove',
      req: { params: { id: 'page-P' } },
      pageProject: 'P',
      perms: { P: ['wiki:manage', 'project:admin'] },
    });
    await expect(admin.allowed).resolves.toBe(true);
  });
});
