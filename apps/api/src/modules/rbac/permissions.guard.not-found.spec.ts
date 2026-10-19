import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import {
  PROJECT_REF_KEY,
  type ProjectRefMeta,
} from '../../common/decorators/project-ref.decorator';
import { PermissionsGuard } from './permissions.guard';
import { RbacService } from './rbac.service';

/**
 * Guard THẬT + RbacService THẬT trên Prisma giả: so sánh phản hồi 404 của "không tồn tại" với "dự án riêng tư người
 * ngoài không được thấy" — phải GIỐNG HỆT (status, code, message, details) để không lộ sự tồn tại của dự án.
 */
type Scenario = 'missing' | 'hidden';

async function run(ref: ProjectRefMeta | undefined, params: Record<string, string>, sc: Scenario) {
  const hidden = sc === 'hidden';
  const prisma = {
    project: {
      findFirst: vi.fn(
        (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
          const w = args.where;
          // projectKey resolver
          if ('key' in w) return Promise.resolve(hidden ? { id: 'P1' } : null);
          // assertProjectVisible: dự án riêng tư người gọi không phải thành viên
          if (args.select && 'memberships' in args.select)
            return Promise.resolve({ isPrivate: true, memberships: [] });
          // assertProjectInWorkspace
          return Promise.resolve(hidden ? { id: 'P1' } : null);
        },
      ),
    },
    issue: {
      findFirst: vi.fn(() => Promise.resolve(hidden ? { projectId: 'P1' } : null)),
    },
    workspaceMembership: {
      findUnique: vi.fn(() =>
        Promise.resolve({ roleId: 'r', roles: [{ role: { id: 'r', name: 'Workspace Member' } }] }),
      ),
    },
    rolePermission: {
      findMany: vi.fn(() => Promise.resolve([{ permission: { key: 'project:view' } }])),
    },
    role: { findMany: vi.fn(() => Promise.resolve([])) },
    projectMembership: { findUnique: vi.fn(() => Promise.resolve(null)) },
  };
  const rbac = new RbacService(
    prisma as never,
    { getClient: () => null, isAvailable: () => false } as never,
  );
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === PERMISSIONS_KEY ? ['project:view'] : key === PROJECT_REF_KEY ? ref : undefined,
    ),
  };
  const guard = new PermissionsGuard(reflector as unknown as Reflector, rbac);
  const req = {
    user: { id: 'U1', workspaceId: 'W1', isSystemAdmin: false },
    params,
    query: {},
    body: {},
  };
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  try {
    await guard.canActivate(ctx);
  } catch (e) {
    const ex = e as { getStatus(): number; getResponse(): unknown };
    return { status: ex.getStatus(), body: ex.getResponse() };
  }
  throw new Error('guard không ném lỗi');
}

describe('PermissionsGuard — 404 của dự án riêng tư giống hệt 404 của tài nguyên không tồn tại', () => {
  const cases: [string, ProjectRefMeta | undefined, Record<string, string>][] = [
    ['projectKey (GET /projects/:key)', { kind: 'projectKey', param: 'key' }, { key: 'HR' }],
    ['param projectId', { kind: 'param', param: 'projectId' }, { projectId: 'P1' }],
    ['không @ProjectRef, có :projectId', undefined, { projectId: 'P1' }],
    ['issue theo id', { kind: 'issue', param: 'id' }, { id: 'I1' }],
  ];

  it.each(cases)('%s', async (_name, ref, params) => {
    const missing = await run(ref, params, 'missing');
    const hidden = await run(ref, params, 'hidden');
    expect(missing.status).toBe(404);
    expect(hidden).toEqual(missing);
  });
});
