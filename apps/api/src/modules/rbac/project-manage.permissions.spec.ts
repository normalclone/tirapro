import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { GoalsController } from '../goals/goals.controller';
import { RaidController } from '../raid/raid.controller';
import { SlaController } from '../sla/sla.controller';
import { PermissionsGuard } from './permissions.guard';

/**
 * Mục tiêu / rủi ro / chính sách thời gian xử lý của MỘT dự án: quyền cấp tổ chức (goal:manage / risk:manage / sla:manage)
 * HOẶC quản trị CHÍNH dự án đó (project:admin). PermissionsGuard THẬT + metadata THẬT của controller; RbacService giả trả
 * quyền theo (người, dự án) và tra dự án của hàng theo id. Dự án lấy từ `body.projectId` khi tạo, từ HÀNG khi sửa/xoá —
 * không bao giờ tin body cho hàng đã có.
 */
type Row = 'rowA' | 'rowB';
const ROW_PROJECT: Record<Row, string> = { rowA: 'A', rowB: 'B' };

const PERMS: Record<string, Record<string, string[]>> = {
  // người → dự án → quyền hiệu lực ('*' = mọi dự án)
  adminA: { A: ['project:view', 'project:admin'], B: ['project:view'] },
  orgGoals: { '*': ['project:view', 'goal:manage'] },
  orgRisk: { '*': ['project:view', 'risk:manage'] },
  orgSla: { '*': ['project:view', 'sla:manage'] },
  viewer: { '*': ['project:view'] },
};

interface Case {
  name: string;
  controller: new (...a: never[]) => object;
  method: string;
  /** Hàng được trỏ bằng `:id` (không có → route tạo mới, dùng body.projectId). */
  row?: boolean;
  org: string;
}

const CASES: Case[] = [
  ...(
    [
      'create',
      'update',
      'remove',
      'addKeyResult',
      'updateKeyResult',
      'removeKeyResult',
      'addCheckIn',
      'addIssues',
      'removeIssues',
    ] as const
  ).map((method) => ({
    name: `goals.${method}`,
    controller: GoalsController as never,
    method,
    row: method !== 'create',
    org: 'orgGoals',
  })),
  ...(['create', 'update', 'remove'] as const).map((method) => ({
    name: `raid.${method}`,
    controller: RaidController as never,
    method,
    row: method !== 'create',
    org: 'orgRisk',
  })),
  ...(['create', 'update', 'remove'] as const).map((method) => ({
    name: `sla.${method}`,
    controller: SlaController as never,
    method,
    row: method !== 'create',
    org: 'orgSla',
  })),
];

async function call(c: Case, user: string, target: string, bodyProjectId?: string) {
  const rbac = {
    assertProjectInOrganization: vi.fn(() => Promise.resolve()),
    assertProjectVisible: vi.fn(() => Promise.resolve()),
    resolveProjectId: vi.fn((_w: string, _k: string, id: string) =>
      Promise.resolve({ projectId: ROW_PROJECT[id as Row] ?? null }),
    ),
    getEffectivePermissions: vi.fn((u: string, _w: string, p: string | null) => {
      const byProject = PERMS[u] ?? {};
      return Promise.resolve(new Set(byProject[p ?? ''] ?? byProject['*'] ?? []));
    }),
  };
  const guard = new PermissionsGuard(new Reflector(), rbac as never);
  const handler = (c.controller.prototype as Record<string, () => unknown>)[c.method]!;
  const req = {
    user: { id: user, organizationId: 'W1', isSystemAdmin: false },
    // Hàng sửa/xoá: `:id` là hàng; dự án thật suy từ hàng. Route tạo: không có params, dự án ở body.
    params: c.row ? { id: target } : {},
    query: {},
    body: c.row ? { projectId: bodyProjectId } : { projectId: target },
  };
  const ctx = {
    getHandler: () => handler,
    getClass: () => c.controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  try {
    await guard.canActivate(ctx);
    return 'ok' as const;
  } catch (e) {
    return (e as { getStatus(): number }).getStatus();
  }
}

describe.each(CASES)('$name — quyền cấp tổ chức HOẶC quản trị chính dự án', (c) => {
  // Route tạo nhận dự án từ body (`A`/`B`); route theo hàng nhận id hàng (`rowA`/`rowB`).
  const own = c.row ? 'rowA' : 'A';
  const other = c.row ? 'rowB' : 'B';

  it('quản trị dự án A: được ở A, KHÔNG được ở B (403)', async () => {
    expect(await call(c, 'adminA', own)).toBe('ok');
    expect(await call(c, 'adminA', other)).toBe(403);
  });

  it('quyền cấp tổ chức tương ứng: được ở mọi dự án; quyền cấp tổ chức của việc KHÁC thì không', async () => {
    expect(await call(c, c.org, own)).toBe('ok');
    expect(await call(c, c.org, other)).toBe('ok');
    for (const wrong of ['orgGoals', 'orgRisk', 'orgSla'].filter((x) => x !== c.org))
      expect(await call(c, wrong, own), wrong).toBe(403);
  });

  it('người chỉ xem: 403', async () => {
    expect(await call(c, 'viewer', own)).toBe(403);
  });

  if (c.row)
    it('không tin body: sửa/xoá hàng của dự án B kèm body.projectId = A vẫn bị chặn', async () => {
      expect(await call(c, 'adminA', 'rowB', 'A')).toBe(403);
    });
});
