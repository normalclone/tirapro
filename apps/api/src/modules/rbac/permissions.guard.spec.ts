import { NotFoundAppException } from '../../common/exceptions/app.exception';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import {
  PROJECT_REF_KEY,
  type ProjectRefMeta,
} from '../../common/decorators/project-ref.decorator';
import { PermissionsGuard } from './permissions.guard';

type Req = {
  user?: unknown;
  ownOnly?: Set<string>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, string | string[]>;
};

function setup(opts: {
  required?: string[];
  ref?: ProjectRefMeta;
  req: Req;
  resolved?: { projectId: string | null } | null;
  projectInWorkspace?: boolean;
  effective?: string[];
}) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === PERMISSIONS_KEY) return opts.required ?? ['issue:update'];
      if (key === PROJECT_REF_KEY) return opts.ref;
      return undefined;
    }),
  };
  const rbac = {
    getEffectivePermissions: vi.fn(() =>
      Promise.resolve(new Set(opts.effective ?? ['issue:update'])),
    ),
    resolveProjectId: vi.fn(() =>
      Promise.resolve(opts.resolved === undefined ? { projectId: 'P-cua-I1' } : opts.resolved),
    ),
    assertProjectInWorkspace: vi.fn(() =>
      opts.projectInWorkspace === false
        ? Promise.reject(new NotFoundAppException('Dự án'))
        : Promise.resolve(),
    ),
  };
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => opts.req }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guard = new PermissionsGuard(reflector as any, rbac as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { guard, rbac, req: opts.req, ctx: ctx as unknown as ExecutionContext };
}

const user = { id: 'U1', workspaceId: 'W1', isSystemAdmin: false };

describe('PermissionsGuard', () => {
  it('lấy projectId từ resource (issue), KHÔNG tin query/body.projectId do client gửi', async () => {
    const { guard, rbac, ctx } = setup({
      ref: { kind: 'issue', param: 'id' },
      req: {
        user: { ...user },
        params: { id: 'I1' },
        query: { projectId: 'P-khac' },
        body: { projectId: 'P-khac-2' },
      },
    });
    await guard.canActivate(ctx);
    expect(rbac.resolveProjectId).toHaveBeenCalledWith('W1', 'issue', 'I1');
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', 'P-cua-I1');
  });

  it('resource không thuộc workspace (resolveProjectId = null) -> NotFound', async () => {
    const { guard, rbac, ctx } = setup({
      ref: { kind: 'issue', param: 'id' },
      resolved: null,
      req: { user: { ...user }, params: { id: 'I-ws-khac' } },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundAppException);
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it("@ProjectRef('comment','id'): comment ngoài workspace -> NotFound", async () => {
    const { guard, rbac, ctx } = setup({
      ref: { kind: 'comment', param: 'id' },
      resolved: null,
      req: { user: { ...user }, params: { id: 'C-ws-khac' } },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundAppException);
    expect(rbac.resolveProjectId).toHaveBeenCalledWith('W1', 'comment', 'C-ws-khac');
  });

  it('tài nguyên cấp workspace (projectId null) -> tính quyền ở cấp workspace, KHÔNG NotFound', async () => {
    const { guard, rbac, ctx } = setup({
      ref: { kind: 'raid', param: 'id' },
      resolved: { projectId: null },
      req: { user: { ...user }, params: { id: 'R1' }, body: { projectId: 'P-khac' } },
    });
    await guard.canActivate(ctx);
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', null);
  });

  it('route có :id nhưng không @ProjectRef: bỏ qua body.projectId (không cho client lái dự án)', async () => {
    const { guard, rbac, ctx } = setup({
      req: { user: { ...user }, params: { id: 'R-o-P2' }, body: { projectId: 'P1' } },
    });
    await guard.canActivate(ctx);
    expect(rbac.assertProjectInWorkspace).not.toHaveBeenCalled();
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', null);
  });

  it('route có tham số khác ngoài projectId: params.projectId vẫn được dùng, body bị bỏ qua', async () => {
    const { guard, rbac, ctx } = setup({
      req: {
        user: { ...user },
        params: { projectId: 'P1', id: 'X' },
        body: { projectId: 'P-khac' },
      },
    });
    await guard.canActivate(ctx);
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', 'P1');
  });

  it('projectId dạng mảng (query ?projectId=a&projectId=b / body) -> NotFound, không tính quyền', async () => {
    const q = setup({
      ref: { kind: 'query', param: 'projectId' },
      req: { user: { ...user }, query: { projectId: ['P1', 'P2'] } },
    });
    await expect(q.guard.canActivate(q.ctx)).rejects.toBeInstanceOf(NotFoundAppException);
    expect(q.rbac.getEffectivePermissions).not.toHaveBeenCalled();

    const b = setup({ req: { user: { ...user }, params: {}, body: { projectId: ['P1'] } } });
    await expect(b.guard.canActivate(b.ctx)).rejects.toBeInstanceOf(NotFoundAppException);
    expect(b.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it("@ProjectRef('param','projectId') đọc req.params và kiểm dự án thuộc workspace", async () => {
    const { guard, rbac, ctx } = setup({
      ref: { kind: 'param', param: 'projectId' },
      req: { user: { ...user }, params: { projectId: 'P1' }, query: { projectId: 'P-khac' } },
    });
    await guard.canActivate(ctx);
    expect(rbac.assertProjectInWorkspace).toHaveBeenCalledWith('P1', 'W1');
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', 'P1');
  });

  it("@ProjectRef('body','projectId') đọc req.body", async () => {
    const { guard, rbac, ctx } = setup({
      ref: { kind: 'body', param: 'projectId' },
      req: { user: { ...user }, params: { projectId: 'P-param' }, body: { projectId: 'P-body' } },
    });
    await guard.canActivate(ctx);
    expect(rbac.assertProjectInWorkspace).toHaveBeenCalledWith('P-body', 'W1');
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', 'P-body');
  });

  it("@ProjectRef('query','projectId') đọc req.query nhưng vẫn kiểm thuộc workspace", async () => {
    const { guard, rbac, ctx } = setup({
      projectInWorkspace: false,
      ref: { kind: 'query', param: 'projectId' },
      req: { user: { ...user }, query: { projectId: 'P-ws-khac' } },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundAppException);
    expect(rbac.assertProjectInWorkspace).toHaveBeenCalledWith('P-ws-khac', 'W1');
  });

  it("@ProjectRef('query','projectId') với ?projectId=none (sentinel mục dùng chung) -> quyền cấp workspace, không 404", async () => {
    const { guard, rbac, ctx } = setup({
      projectInWorkspace: false,
      ref: { kind: 'query', param: 'projectId' },
      req: { user: { ...user }, query: { projectId: 'none' } },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(rbac.assertProjectInWorkspace).not.toHaveBeenCalled();
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', null);
  });

  it('không có @ProjectRef: chỉ đọc params/body.projectId, bỏ qua query', async () => {
    const a = setup({
      req: { user: { ...user }, params: {}, body: {}, query: { projectId: 'P-khac' } },
    });
    await a.guard.canActivate(a.ctx);
    expect(a.rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', null);
    expect(a.rbac.assertProjectInWorkspace).not.toHaveBeenCalled();

    const b = setup({
      req: {
        user: { ...user },
        params: { projectId: 'P1' },
        body: {},
        query: { projectId: 'P-khac' },
      },
    });
    await b.guard.canActivate(b.ctx);
    expect(b.rbac.assertProjectInWorkspace).toHaveBeenCalledWith('P1', 'W1');
    expect(b.rbac.getEffectivePermissions).toHaveBeenCalledWith('U1', 'W1', 'P1');
  });

  it('projectId (params/body) thuộc workspace khác -> NotFound, không tính quyền', async () => {
    const { guard, rbac, ctx } = setup({
      projectInWorkspace: false,
      req: { user: { ...user }, params: { projectId: 'P-ws-khac' } },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundAppException);
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('thiếu quyền -> Forbidden; có quyền :own -> qua', async () => {
    const denied = setup({
      effective: [],
      ref: { kind: 'issue', param: 'id' },
      req: { user: { ...user }, params: { id: 'I1' } },
    });
    await expect(denied.guard.canActivate(denied.ctx)).rejects.toMatchObject({ status: 403 });

    const own = setup({
      effective: ['issue:update:own'],
      ref: { kind: 'issue', param: 'id' },
      req: { user: { ...user }, params: { id: 'I1' } },
    });
    await expect(own.guard.canActivate(own.ctx)).resolves.toBe(true);
  });

  it('đánh dấu req.ownOnly chỉ cho quyền thoả bằng :own; có quyền đầy đủ thì không đánh dấu', async () => {
    const own = setup({
      required: ['issue:edit'],
      effective: ['issue:edit:own'],
      ref: { kind: 'issue', param: 'id' },
      req: { user: { ...user }, params: { id: 'I1' } },
    });
    await own.guard.canActivate(own.ctx);
    expect([...own.req.ownOnly!]).toEqual(['issue:edit']);

    const full = setup({
      required: ['issue:edit'],
      effective: ['issue:edit', 'issue:edit:own'],
      ref: { kind: 'issue', param: 'id' },
      req: { user: { ...user }, params: { id: 'I1' } },
    });
    await full.guard.canActivate(full.ctx);
    expect(full.req.ownOnly!.size).toBe(0);

    const mixed = setup({
      required: ['issue:edit', 'comment:create'],
      effective: ['issue:edit:own', 'comment:create'],
      ref: { kind: 'issue', param: 'id' },
      req: { user: { ...user }, params: { id: 'I1' } },
    });
    await mixed.guard.canActivate(mixed.ctx);
    expect([...mixed.req.ownOnly!]).toEqual(['issue:edit']);
  });

  it('system admin được miễn; route không yêu cầu quyền thì qua', async () => {
    const admin = setup({
      ref: { kind: 'issue', param: 'id' },
      req: { user: { ...user, isSystemAdmin: true }, params: { id: 'I1' } },
    });
    await expect(admin.guard.canActivate(admin.ctx)).resolves.toBe(true);
    expect(admin.rbac.resolveProjectId).not.toHaveBeenCalled();

    const open = setup({ required: [], req: { user: { ...user } } });
    await expect(open.guard.canActivate(open.ctx)).resolves.toBe(true);
  });
});
