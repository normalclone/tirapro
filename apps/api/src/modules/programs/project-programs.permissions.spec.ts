import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { ProgramsController, ProjectProgramsController } from './programs.controller';

/**
 * `PUT /projects/:id/programs` đi qua PermissionsGuard THẬT với metadata THẬT của controller: quyền `project:admin` được tính
 * theo CHÍNH dự án ở `:id` — quản trị dự án A không đổi được nhóm của dự án B; quản trị tổ chức (có quyền ở mọi dự án) thì
 * được; người chỉ xem thì không. RbacService giả trả quyền theo (người, dự án).
 */
const PERMS: Record<string, Record<string, string[]>> = {
  // người → dự án → quyền hiệu lực
  adminA: { A: ['project:view', 'project:admin'], B: ['project:view'] },
  orgAdmin: {
    A: ['project:view', 'project:admin'],
    B: ['project:view', 'project:admin'],
  },
  viewer: { A: ['project:view'], B: ['project:view'] },
};

async function put(user: string, projectId: string): Promise<'ok' | number> {
  const rbac = {
    assertProjectInOrganization: vi.fn(() => Promise.resolve()),
    assertProjectVisible: vi.fn(() => Promise.resolve()),
    getEffectivePermissions: vi.fn((u: string, _w: string, p: string | null) =>
      Promise.resolve(new Set(p ? (PERMS[u]?.[p] ?? []) : [])),
    ),
  };
  const guard = new PermissionsGuard(new Reflector(), rbac as never);
  const handler = ProjectProgramsController.prototype.setForProject;
  const req = {
    user: { id: user, organizationId: 'W1', isSystemAdmin: false },
    params: { id: projectId },
    query: {},
    body: { programIds: ['g1'] },
  };
  const ctx = {
    getHandler: () => handler,
    getClass: () => ProjectProgramsController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  try {
    await guard.canActivate(ctx);
    return 'ok';
  } catch (e) {
    return (e as { getStatus(): number }).getStatus();
  }
}

describe('PUT /projects/:id/programs — quyền theo dự án ở :id', () => {
  it('quản trị dự án A: đổi được nhóm của A, KHÔNG đổi được nhóm của B (403)', async () => {
    expect(await put('adminA', 'A')).toBe('ok');
    expect(await put('adminA', 'B')).toBe(403);
  });

  it('quản trị tổ chức đổi được ở mọi dự án; người chỉ xem thì không', async () => {
    expect(await put('orgAdmin', 'A')).toBe('ok');
    expect(await put('orgAdmin', 'B')).toBe('ok');
    expect(await put('viewer', 'A')).toBe(403);
  });

  it('không cần program:manage (việc của quản trị dự án), còn quản lý danh mục nhóm vẫn cần program:manage', () => {
    const reflector = new Reflector();
    const of = (cls: { prototype: object }, method: string) =>
      reflector.get<string[]>(
        PERMISSIONS_KEY,
        (cls.prototype as Record<string, () => unknown>)[method]!,
      );
    expect(of(ProjectProgramsController, 'setForProject')).toEqual(['project:admin']);
    expect(of(ProgramsController, 'create')).toEqual(['program:manage']);
    expect(of(ProgramsController, 'update')).toEqual(['program:manage']);
    expect(of(ProgramsController, 'setProjects')).toEqual(['program:manage']);
    expect(of(ProgramsController, 'remove')).toEqual(['program:manage']);
  });
});
