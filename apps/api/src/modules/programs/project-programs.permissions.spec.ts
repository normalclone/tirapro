import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { ProgramsController, ProjectProgramsController } from './programs.controller';

/**
 * Nhóm dự án là của riêng từng người: `PUT /projects/:id/programs` đi qua PermissionsGuard THẬT với metadata THẬT của
 * controller — bất kỳ ai XEM được dự án ở `:id` đều tự xếp nhóm của mình (không cần quản trị dự án / quyền nhóm); dự án không
 * xem được → bị chặn (403 thiếu quyền xem, hoặc 404 nếu dự án riêng tư người đó không thấy). RbacService giả trả quyền theo
 * (người, dự án).
 */
const PERMS: Record<string, Record<string, string[]>> = {
  // người → dự án → quyền hiệu lực
  viewer: { A: ['project:view'], B: ['project:view'] },
  adminA: { A: ['project:view', 'project:admin'], B: ['project:view'] },
  onlyA: { A: ['project:view'] }, // không có quyền xem B
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

describe('PUT /projects/:id/programs — ai xem được dự án thì xếp nhóm của mình', () => {
  it('chỉ-xem (không quản trị) vẫn được; quản trị dự án cũng chỉ như một người xem (không có đặc quyền)', async () => {
    expect(await put('viewer', 'A')).toBe('ok');
    expect(await put('viewer', 'B')).toBe('ok');
    expect(await put('adminA', 'B')).toBe('ok');
  });

  it('không xem được dự án ở :id → bị chặn (403)', async () => {
    expect(await put('onlyA', 'B')).toBe(403);
  });

  it('không đòi program:manage hay project:admin; mọi route /programs chỉ cần organization:view', () => {
    const reflector = new Reflector();
    const of = (cls: { prototype: object }, method: string) =>
      reflector.get<string[]>(
        PERMISSIONS_KEY,
        (cls.prototype as Record<string, () => unknown>)[method]!,
      );
    expect(of(ProjectProgramsController, 'setForProject')).toEqual(['project:view']);
    for (const m of ['list', 'get', 'create', 'update', 'remove'])
      expect(of(ProgramsController, m), m).toEqual(['organization:view']);
  });

  it('không còn route rollup / đặt dự án theo nhóm (đã gỡ)', () => {
    const proto = ProgramsController.prototype as unknown as Record<string, unknown>;
    expect(proto.rollup).toBeUndefined();
    expect(proto.setProjects).toBeUndefined();
  });
});
