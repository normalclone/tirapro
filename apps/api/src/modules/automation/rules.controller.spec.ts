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
  const handlers = [
    'list',
    'get',
    'create',
    'update',
    'remove',
    'runs',
    'test',
    'previewMatch',
  ] as const;
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

describe('RulesController.test — truyền người xem xuống dryRun (mã việc dự án ẩn → 404)', () => {
  it('gọi engine.dryRun(workspaceId, rule, issueKey, user.id)', async () => {
    const rule = { id: 'r1', lastRunAt: null };
    const engine = { dryRun: vi.fn(() => Promise.resolve({ status: 'SUCCESS', log: [] })) };
    const rules = { require: vi.fn(() => Promise.resolve(rule)) };
    const controller = new RulesController(rules as never, engine as never, {} as never);
    await controller.test('w1', { id: 'u1' } as never, 'r1', { issueKey: 'HR-1' });
    expect(engine.dryRun).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ id: 'r1' }),
      'HR-1',
      'u1',
    );
  });
});

describe('RulesController.previewMatch — POST /automation/rules/preview-match (132b)', () => {
  const meta = (key: string) => Reflect.getMetadata(key, proto.previewMatch) as unknown;
  it('projectId đọc từ body; là POST preview-match; throttle riêng 30 lần / 60 giây', () => {
    expect(meta(PROJECT_REF_KEY)).toEqual({ kind: 'body', param: 'projectId' });
    expect(meta('method')).toBe(1); // RequestMethod.POST
    expect(meta('path')).toBe('preview-match');
    expect(meta('THROTTLER:LIMITdefault')).toBe(30);
    expect(meta('THROTTLER:TTLdefault')).toBe(60_000);
  });
  it('truyền workspaceId, user.id (người soạn, không phải hệ thống) và body cho service', async () => {
    const preview = { previewMatch: vi.fn().mockResolvedValue({ count: 3 }) };
    const ctrl = new RulesController({} as never, {} as never, preview as never);
    const body = { projectId: 'p1', conditions: [{ jql: 'x = 1' }] };
    await ctrl.previewMatch('w1', { id: 'u1' } as never, body);
    expect(preview.previewMatch).toHaveBeenCalledWith('w1', 'u1', body);
  });
});
