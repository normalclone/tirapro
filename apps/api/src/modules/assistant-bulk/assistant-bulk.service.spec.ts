import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { AssistantBulkService } from './assistant-bulk.service';

const ALL_ISSUE = [PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_EDIT];
const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'me',
  email: 'me@x.vn',
  displayName: 'Tôi',
  organizationId: 'o1',
  isSystemAdmin: false,
  ...over,
});

interface IssueRow {
  id: string;
  key: string;
  projectId: string;
  assigneeId: string | null;
  version: number;
}
const issue = (n: number, over: Partial<IssueRow> = {}): IssueRow => ({
  id: `i${n}`,
  key: `DEMO-${n}`,
  projectId: 'pA',
  assigneeId: null,
  version: 1,
  ...over,
});

function setup(opts: {
  issues?: IssueRow[];
  perms?: Record<string, string[]>;
  hidden?: string[];
  assignable?: (assigneeId: string, projectId: string) => boolean;
  bulkUpdate?: (...args: never[]) => unknown;
}) {
  const issues = opts.issues ?? [];
  const prisma = { issue: { findMany: vi.fn(() => Promise.resolve(issues)) } };
  const rbac = {
    assertProjectVisible: vi.fn((_u: string, _o: string, projectId: string) =>
      opts.hidden?.includes(projectId) ? Promise.reject(new Error('404')) : Promise.resolve(),
    ),
    getEffectivePermissions: vi.fn((_u: string, _o: string, projectId: string) =>
      Promise.resolve(new Set(opts.perms?.[projectId] ?? [])),
    ),
  };
  const bulkUpdate = vi.fn(
    opts.bulkUpdate ??
      ((
        _o: string,
        _u: string,
        input: { items: { id: string }[]; patch: { assigneeId: string | null } },
      ) =>
        Promise.resolve({
          updated: input.items.map((it) => ({
            id: it.id,
            assigneeId: input.patch.assigneeId,
            version: 2,
          })),
          conflicts: [],
        })),
  );
  const issuesSvc = {
    bulkUpdate,
    isAssignableMember: vi.fn((_o: string, a: string, _db: unknown, p: string) =>
      Promise.resolve(opts.assignable ? opts.assignable(a, p) : true),
    ),
  };
  return {
    service: new AssistantBulkService(
      prisma as never,
      rbac as never,
      issuesSvc as never,
      {} as never,
    ),
    prisma,
    rbac,
    bulkUpdate,
    issuesSvc,
  };
}

describe('AssistantBulkService.assign — quyền từng dòng', () => {
  it('dòng ở dự án không đủ quyền KHÔNG BAO GIỜ chạm vào bulkUpdate; dự án đủ quyền vẫn chạy', async () => {
    const { service, bulkUpdate } = setup({
      issues: [issue(1), issue(2, { projectId: 'pB' }), issue(3, { projectId: 'pC' })],
      perms: {
        pA: ALL_ISSUE,
        pB: [PERMISSIONS.ISSUE_EDIT], // thiếu issue:assign
        pC: [PERMISSIONS.ISSUE_ASSIGN], // thiếu issue:edit
      },
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u1' },
      { issueId: 'i3', version: 1, assigneeId: 'u1' },
    ]);
    expect(res.results.map((r) => [r.issueId, r.status])).toEqual([
      ['i1', 'ok'],
      ['i2', 'skipped'],
      ['i3', 'skipped'],
    ]);
    expect(res.results[1]!.reason).toMatch(/không đủ quyền/);
    expect(bulkUpdate).toHaveBeenCalledTimes(1);
    expect(bulkUpdate.mock.calls[0]![2]).toMatchObject({
      projectId: 'pA',
      items: [{ id: 'i1', version: 1 }],
    });
  });

  it('dự án không xem được (hoặc việc không tồn tại / ở tổ chức khác) → "không tìm thấy", không lộ sự tồn tại, không ghi', async () => {
    const { service, bulkUpdate } = setup({
      issues: [issue(1, { projectId: 'pHidden' })],
      perms: { pHidden: ALL_ISSUE },
      hidden: ['pHidden'],
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'ghost', version: 1, assigneeId: 'u1' },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(res.results.every((r) => /Không tìm thấy/.test(r.reason ?? ''))).toBe(true);
    expect(bulkUpdate).not.toHaveBeenCalled();
  });

  it('quản trị hệ thống được qua cửa quyền; người thường chỉ có issue:edit:own bị chặn', async () => {
    const sa = setup({ issues: [issue(1)], perms: {} });
    const r1 = await sa.service.assign('o1', user({ isSystemAdmin: true }), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
    ]);
    expect(r1.results[0]!.status).toBe('ok');
    const own = setup({
      issues: [issue(1)],
      perms: { pA: [PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_EDIT_OWN] },
    });
    const r2 = await own.service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
    ]);
    expect(r2.results[0]!.status).toBe('skipped');
    expect(own.bulkUpdate).not.toHaveBeenCalled();
  });
});

describe('AssistantBulkService.assign — thực hiện + OCC', () => {
  const perms = { pA: ALL_ISSUE, pB: ALL_ISSUE };
  it('gom theo (dự án, người nhận): mỗi nhóm một lần gọi; trả người cũ + version mới để Hoàn tác', async () => {
    const { service, bulkUpdate } = setup({
      issues: [issue(1, { assigneeId: 'old' }), issue(2), issue(3), issue(4, { projectId: 'pB' })],
      perms,
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u2' },
      { issueId: 'i3', version: 1, assigneeId: 'u1' },
      { issueId: 'i4', version: 1, assigneeId: 'u1' },
    ]);
    expect(bulkUpdate).toHaveBeenCalledTimes(3); // (pA,u1) (pA,u2) (pB,u1)
    expect(res.results[0]).toMatchObject({
      issueId: 'i1',
      status: 'ok',
      previousAssigneeId: 'old',
      assigneeId: 'u1',
      version: 2,
    });
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('xung đột phiên bản (người khác sửa giữa chừng) → bỏ qua dòng đó, các dòng khác vẫn ok', async () => {
    const { service } = setup({
      issues: [issue(1), issue(2)],
      perms,
      bulkUpdate: (_o: never, _u: never, input: never) => {
        const items = (input as { items: { id: string }[] }).items;
        return Promise.resolve({
          updated: items
            .filter((i) => i.id !== 'i2')
            .map((i) => ({ id: i.id, assigneeId: 'u1', version: 2 })),
          conflicts: [{ id: 'i2', version: 5 }],
        });
      },
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u1' },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'skipped']);
    expect(res.results[1]).toMatchObject({ version: 5 });
    expect(res.results[1]!.reason).toMatch(/không ghi đè/);
  });

  it('version lệch ngay lúc kiểm (xem trước cũ) / đã là người phụ trách / người nhận không hợp lệ → bỏ qua có lý do, không gọi ghi', async () => {
    const { service, bulkUpdate } = setup({
      issues: [issue(1, { version: 3 }), issue(2, { assigneeId: 'u1' }), issue(3)],
      perms,
      assignable: () => false,
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u1' },
      { issueId: 'i3', version: 1, assigneeId: 'u9' },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(res.results[0]!.reason).toMatch(/sau lúc xem trước/);
    expect(res.results[1]!.reason).toMatch(/đã là người phụ trách/);
    expect(res.results[2]!.reason).toMatch(/không thuộc tổ chức/);
    expect(bulkUpdate).not.toHaveBeenCalled();
  });
});

describe('AssistantBulkService.assign — lỗi một phần + Hoàn tác', () => {
  const perms = { pA: ALL_ISSUE, pB: ALL_ISSUE };
  it('LỖI MỘT NHÓM (dự án đã lưu trữ…) không làm hỏng nhóm khác: dòng lỗi "failed" kèm lý do, dòng kia "ok"', async () => {
    const { service } = setup({
      issues: [issue(1), issue(2, { projectId: 'pB' })],
      perms,
      bulkUpdate: (_o: never, _u: never, input: never) => {
        const i = input as { projectId: string; items: { id: string }[] };
        if (i.projectId === 'pB')
          return Promise.reject(new BusinessRuleException('Dự án đã lưu trữ'));
        return Promise.resolve({
          updated: i.items.map((x) => ({ id: x.id, assigneeId: 'u1', version: 2 })),
          conflicts: [],
        });
      },
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u1' },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'failed']);
    expect(res.results[1]!.reason).toMatch(/Dự án đã lưu trữ/);
  });

  it('dòng trùng (cùng việc hai lần) chỉ xử lý một lần, giữ thứ tự đầu vào', async () => {
    const { service, bulkUpdate } = setup({ issues: [issue(1), issue(2)], perms });
    const res = await service.assign('o1', user(), [
      { issueId: 'i2', version: 1, assigneeId: 'u1' },
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u2' },
    ]);
    expect(res.results.map((r) => r.issueId)).toEqual(['i2', 'i1']);
    expect(bulkUpdate).toHaveBeenCalledTimes(1);
  });

  it('chia lô > 100 việc cùng nhóm thành nhiều lần gọi (giới hạn của sửa hàng loạt)', async () => {
    const many = Array.from({ length: 130 }, (_, i) => issue(i + 1));
    const { service, bulkUpdate } = setup({ issues: many, perms });
    const res = await service.assign(
      'o1',
      user(),
      many.map((m) => ({ issueId: m.id, version: 1, assigneeId: 'u1' })),
    );
    expect(bulkUpdate).toHaveBeenCalledTimes(2);
    expect((bulkUpdate.mock.calls[0]![2] as unknown as { items: unknown[] }).items).toHaveLength(
      100,
    );
    expect(res.results.every((r) => r.status === 'ok')).toBe(true);
  });

  it('HOÀN TÁC sau lỗi một phần: chỉ các dòng "ok" có previousAssigneeId để khôi phục; dòng bị bỏ qua không bị đụng', async () => {
    const first = setup({
      issues: [
        issue(1, { assigneeId: 'old1' }),
        issue(2, { assigneeId: 'old2' }),
        issue(3, { projectId: 'pB' }),
      ],
      perms: { pA: ALL_ISSUE, pB: [] },
    });
    const res = await first.service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u1' },
      { issueId: 'i3', version: 1, assigneeId: 'u1' },
    ]);
    const changed = res.results.filter((r) => r.status === 'ok');
    expect(changed.map((r) => r.issueId)).toEqual(['i1', 'i2']);
    // Undo = trả về người cũ, kèm version SAU khi ghi. Việc i1 bị người khác sửa trong lúc chờ (version 9) → xung đột → bỏ qua.
    const undoRows = changed.map((r) => ({
      issueId: r.issueId,
      version: r.version!,
      assigneeId: r.previousAssigneeId,
    }));
    const second = setup({
      issues: [
        issue(1, { assigneeId: 'u1', version: 9 }),
        issue(2, { assigneeId: 'u1', version: 2 }),
      ],
      perms: { pA: ALL_ISSUE },
    });
    const undo = await second.service.assign('o1', user(), undoRows);
    expect(undo.results.map((r) => [r.issueId, r.status])).toEqual([
      ['i1', 'skipped'],
      ['i2', 'ok'],
    ]);
    expect(second.bulkUpdate).toHaveBeenCalledTimes(1);
    expect(second.bulkUpdate.mock.calls[0]![2]).toMatchObject({
      patch: { assigneeId: 'old2' },
      items: [{ id: 'i2', version: 2 }],
    });
  });

  it('bỏ người phụ trách (undo về "chưa giao") không cần kiểm người nhận', async () => {
    const { service, issuesSvc, bulkUpdate } = setup({
      issues: [issue(1, { assigneeId: 'u1', version: 2 })],
      perms,
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 2, assigneeId: null },
    ]);
    expect(res.results[0]!.status).toBe('ok');
    expect(issuesSvc.isAssignableMember).not.toHaveBeenCalled();
    expect(bulkUpdate.mock.calls[0]![2]).toMatchObject({ patch: { assigneeId: null } });
  });
});

/* ------------------------------ thành viên ------------------------------ */

interface MemberState {
  user: { id: string };
  isOverride: boolean;
  roles: { id: string }[];
}
function setupMembers(opts: {
  /** Dự án riêng tư? (mặc định công khai) */
  isPrivate?: boolean;
  /** Id vai trò mang `project:admin` (mặc định: 'admin'). */
  adminRoles?: string[];
  /** Người giữ organization:admin. */
  orgAdmins?: string[];
  perms?: Record<string, string[]>;
  hidden?: string[];
  state?: Record<string, MemberState[]>;
  setRoles?: (projectId: string, userId: string, roleIds: string[]) => Promise<unknown>;
  clear?: (projectId: string, userId: string) => Promise<unknown>;
}) {
  const rbac = {
    assertProjectVisible: vi.fn((_u: string, _o: string, projectId: string) =>
      opts.hidden?.includes(projectId) ? Promise.reject(new Error('404')) : Promise.resolve(),
    ),
    getEffectivePermissions: vi.fn((_u: string, _o: string, projectId: string) =>
      Promise.resolve(new Set(opts.perms?.[projectId] ?? [])),
    ),
  };
  const prisma = {
    project: { findFirst: vi.fn(() => Promise.resolve({ isPrivate: opts.isPrivate === true })) },
    role: {
      findMany: vi.fn((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          args.where.id.in
            .filter((i) => (opts.adminRoles ?? ['admin']).includes(i))
            .map((id) => ({ id })),
        ),
      ),
    },
  };
  const rbacFull = {
    ...rbac,
    holdsOrganizationAdmin: vi.fn((u: string) =>
      Promise.resolve((opts.orgAdmins ?? []).includes(u)),
    ),
  };
  const members = {
    listProject: vi.fn((_o: string, projectId: string) =>
      Promise.resolve(opts.state?.[projectId] ?? []),
    ),
    setProjectRoles: vi.fn((_o: string, p: string, u: string, roleIds: string[]) =>
      opts.setRoles ? opts.setRoles(p, u, roleIds) : Promise.resolve({}),
    ),
    clearProjectOverride: vi.fn((_o: string, p: string, u: string) =>
      opts.clear ? opts.clear(p, u) : Promise.resolve({ success: true }),
    ),
  };
  return {
    service: new AssistantBulkService(
      prisma as never,
      rbacFull as never,
      {} as never,
      members as never,
    ),
    members,
  };
}
const ADMIN = { pA: [PERMISSIONS.PROJECT_ADMIN], pB: [PERMISSIONS.PROJECT_ADMIN] };
const ov = (id: string, ...roles: string[]): MemberState => ({
  user: { id },
  isOverride: true,
  roles: roles.map((r) => ({ id: r })),
});
const dflt = (id: string, ...roles: string[]): MemberState => ({
  user: { id },
  isOverride: false,
  roles: roles.map((r) => ({ id: r })),
});

describe('AssistantBulkService.setMembers — quyền project:admin từng dự án', () => {
  it('dự án người gọi không phải quản trị / không xem được → bỏ qua cả dự án, KHÔNG gọi service thành viên', async () => {
    const { service, members } = setupMembers({
      perms: { pA: [PERMISSIONS.ISSUE_EDIT], pB: ADMIN.pB },
      hidden: ['pHidden'],
      state: { pB: [dflt('u1', 'dev')] },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: null, set: ['tester'] },
      { projectId: 'pHidden', userId: 'u1', expect: null, set: ['tester'] },
      { projectId: 'pB', userId: 'u1', expect: null, set: ['tester'] },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['skipped', 'skipped', 'ok']);
    expect(res.results[0]!.reason).toMatch(/không phải quản trị/);
    expect(res.results[1]!.reason).toMatch(/Không tìm thấy dự án/);
    expect(members.setProjectRoles).toHaveBeenCalledTimes(1);
    expect(members.setProjectRoles).toHaveBeenCalledWith('o1', 'pB', 'u1', ['tester'], 'me');
  });

  it('thêm: tạo vai trò riêng (expect null → set); đã có đúng vai trò (riêng hoặc mặc định) → bỏ qua; expect lệch → bỏ qua', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: {
        pA: [dflt('u1', 'dev'), ov('u2', 'tester'), ov('u3', 'designer'), dflt('u4', 'tester')],
      },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: null, set: ['tester'] }, // ok
      { projectId: 'pA', userId: 'u2', expect: ['tester'], set: ['tester'] }, // đã đúng
      { projectId: 'pA', userId: 'u3', expect: null, set: ['tester'] }, // đã đổi sau xem trước
      { projectId: 'pA', userId: 'u4', expect: null, set: ['tester'] }, // đúng theo mặc định tổ chức
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'skipped', 'skipped', 'skipped']);
    expect(res.results[0]).toMatchObject({ before: null, after: ['tester'] });
    expect(res.results[2]!.reason).toMatch(/đã đổi sau lúc xem trước/);
    expect(res.results[3]!.reason).toMatch(/mặc định của tổ chức/);
    expect(members.setProjectRoles).toHaveBeenCalledTimes(1);
  });

  it('gỡ: chỉ gỡ được vai trò RIÊNG; không có vai trò riêng → bỏ qua; có → clearProjectOverride và trả vai trò cũ', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: { pA: [ov('u1', 'tester', 'dev'), dflt('u2', 'dev')] },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: ['dev', 'tester'], set: null },
      { projectId: 'pA', userId: 'u2', expect: null, set: null },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'skipped']);
    expect(res.results[0]).toMatchObject({ before: ['tester', 'dev'], after: null });
    expect(members.clearProjectOverride).toHaveBeenCalledTimes(1);
    expect(members.clearProjectOverride).toHaveBeenCalledWith('o1', 'pA', 'u1', 'me');
  });

  it('LỖI MỘT DÒNG (vd cấp quyền quản trị) không chặn dòng khác; dòng lỗi giữ nguyên before/after', async () => {
    const { service } = setupMembers({
      perms: ADMIN,
      state: { pA: [dflt('u1', 'dev'), dflt('u2', 'dev')] },
      setRoles: (_p, u) =>
        u === 'u1'
          ? Promise.reject(
              new BusinessRuleException('Chỉ quản trị tổ chức mới cấp quyền quản trị.'),
            )
          : Promise.resolve({}),
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: null, set: ['admin'] },
      { projectId: 'pA', userId: 'u2', expect: null, set: ['admin'] },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['failed', 'ok']);
    expect(res.results[0]).toMatchObject({ before: null, after: null });
    expect(res.results[0]!.reason).toMatch(/Chỉ quản trị tổ chức/);
  });

  it('HOÀN TÁC dựng từ kết quả: chỉ dòng "ok" đảo ngược (expect=after, set=before); vai trò bị người khác đổi sau đó thì bỏ qua', async () => {
    const first = setupMembers({
      perms: ADMIN,
      state: { pA: [dflt('u1', 'dev'), ov('u2', 'tester'), dflt('u3', 'dev')] },
      setRoles: (_p, u) => (u === 'u3' ? Promise.reject(new Error('boom')) : Promise.resolve({})),
    });
    const res = await first.service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: null, set: ['admin'] }, // tạo mới
      { projectId: 'pA', userId: 'u2', expect: ['tester'], set: ['admin'] }, // đổi vai trò riêng
      { projectId: 'pA', userId: 'u3', expect: null, set: ['admin'] }, // lỗi
    ]);
    const undoRows = res.results
      .filter((r) => r.status === 'ok')
      .map((r) => ({ projectId: r.projectId, userId: r.userId, expect: r.after, set: r.before }));
    expect(undoRows.map((r) => r.userId)).toEqual(['u1', 'u2']);
    // Lúc hoàn tác: u1 vẫn đúng 'admin'; u2 đã bị người khác đổi thành 'designer'.
    const second = setupMembers({
      perms: ADMIN,
      state: { pA: [ov('u1', 'admin'), ov('u2', 'designer')] },
    });
    const undo = await second.service.setMembers('o1', user(), undoRows);
    expect(undo.results.map((r) => [r.userId, r.status])).toEqual([
      ['u1', 'ok'],
      ['u2', 'skipped'],
    ]);
    expect(second.members.clearProjectOverride).toHaveBeenCalledWith('o1', 'pA', 'u1', 'me'); // trước đó chưa có vai trò riêng
    expect(second.members.setProjectRoles).not.toHaveBeenCalled();
  });
});

describe('fix round 1 — H1: việc ẩn / không tồn tại có CÙNG MỘT dạng trả về', () => {
  it('việc ở dự án người gọi không xem được và id không tồn tại: mọi trường null, giống hệt nhau (chỉ khác issueId)', async () => {
    const { service, bulkUpdate } = setup({
      issues: [
        issue(7, { projectId: 'pHidden', assigneeId: 'uBoss', version: 9, key: 'SECRET-TASK-7' }),
      ],
      perms: { pHidden: ALL_ISSUE },
      hidden: ['pHidden'],
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i7', version: 9, assigneeId: 'u1' },
      { issueId: 'ghost', version: 9, assigneeId: 'u1' },
    ]);
    const [hidden, ghost] = res.results;
    expect(hidden).toEqual({ ...ghost, issueId: 'i7' });
    expect(hidden).toMatchObject({
      key: null,
      previousAssigneeId: null,
      assigneeId: null,
      version: null,
      status: 'skipped',
    });
    expect(JSON.stringify(res)).not.toContain('SECRET');
    expect(JSON.stringify(res)).not.toContain('uBoss');
    expect(bulkUpdate).not.toHaveBeenCalled();
  });
  it('việc xem được nhưng thiếu quyền vẫn trả khoá của chính nó (đã xem được thì không lộ gì thêm)', async () => {
    const { service } = setup({ issues: [issue(1)], perms: { pA: [PERMISSIONS.ISSUE_EDIT] } });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
    ]);
    expect(res.results[0]).toMatchObject({ key: 'DEMO-1', status: 'skipped' });
  });
});

describe('fix round 1 — L5: chỉ có issue:edit:own', () => {
  it('lý do nói rõ "chỉ được sửa việc của mình"', async () => {
    const { service, bulkUpdate } = setup({
      issues: [issue(1), issue(2)],
      perms: { pA: [PERMISSIONS.ISSUE_ASSIGN, PERMISSIONS.ISSUE_EDIT_OWN] },
    });
    const res = await service.assign('o1', user(), [
      { issueId: 'i1', version: 1, assigneeId: 'u1' },
      { issueId: 'i2', version: 1, assigneeId: 'u1' },
    ]);
    expect(res.results.every((r) => r.status === 'skipped')).toBe(true);
    expect(res.results[0]!.reason).toBe(
      'Bạn chỉ được sửa việc của mình — không đủ quyền giao việc ở dự án của DEMO-1.',
    );
    expect(bulkUpdate).not.toHaveBeenCalled();
  });
});

describe('fix round 1 — M1: không tự khoá mình, không bỏ quản trị viên cuối của dự án riêng tư', () => {
  const mem = (id: string, ...roles: string[]): MemberState => ({
    user: { id },
    isOverride: true,
    roles: roles.map((r) => ({ id: r })),
  });
  const ME = user({ id: 'me' });

  it('tự bỏ / tự hạ quyền quản trị của chính mình → bị chặn, không gọi MembersService; người khác thì vẫn làm được', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: { pA: [mem('me', 'admin'), mem('u2', 'admin'), mem('u3', 'dev')] },
    });
    const res = await service.setMembers('o1', ME, [
      { projectId: 'pA', userId: 'me', expect: ['admin'], set: ['tester'] }, // hạ chính mình
      { projectId: 'pA', userId: 'me', expect: ['admin'], set: null }, // trùng dòng: bỏ
      { projectId: 'pA', userId: 'u2', expect: ['admin'], set: ['tester'] }, // hạ người khác: được (còn me)
    ]);
    expect(res.results.map((r) => [r.userId, r.status])).toEqual([
      ['me', 'skipped'],
      ['u2', 'ok'],
    ]);
    expect(res.results[0]!.reason).toMatch(
      /tự bỏ quyền quản trị của chính mình.*quản trị viên khác/,
    );
    expect(members.setProjectRoles).toHaveBeenCalledTimes(1);
    expect(members.setProjectRoles).toHaveBeenCalledWith('o1', 'pA', 'u2', ['tester'], 'me');
    expect(members.clearProjectOverride).not.toHaveBeenCalled();
  });

  it('gỡ chính mình bằng "gỡ" (clear) cũng bị chặn; giữ nguyên vai trò quản trị thì không bị chặn', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: { pA: [mem('me', 'admin', 'tester')] },
    });
    const res = await service.setMembers('o1', ME, [
      { projectId: 'pA', userId: 'me', expect: ['admin', 'tester'], set: null },
    ]);
    expect(res.results[0]!.status).toBe('skipped');
    expect(members.clearProjectOverride).not.toHaveBeenCalled();
    const keep = await service.setMembers('o1', ME, [
      { projectId: 'pA', userId: 'me', expect: ['admin', 'tester'], set: ['admin', 'dev'] },
    ]);
    expect(keep.results[0]!.status).toBe('ok');
  });

  it('quản trị tổ chức tự đổi vai trò dự án thì không mất quyền (vẫn quản trị qua tổ chức) → không chặn', async () => {
    const { service } = setupMembers({
      perms: ADMIN,
      orgAdmins: ['me'],
      state: { pA: [mem('me', 'admin')] },
    });
    const res = await service.setMembers('o1', ME, [
      { projectId: 'pA', userId: 'me', expect: ['admin'], set: ['tester'] },
    ]);
    expect(res.results[0]!.status).toBe('ok');
  });

  it('DỰ ÁN RIÊNG TƯ: không để mất quản trị viên cuối (kể cả cộng dồn nhiều dòng); công khai thì không áp luật này', async () => {
    const state = { pA: [mem('u2', 'admin'), mem('u3', 'admin'), mem('u4', 'dev')] };
    const priv = setupMembers({ perms: ADMIN, isPrivate: true, state });
    const res = await priv.service.setMembers('o1', ME, [
      { projectId: 'pA', userId: 'u2', expect: ['admin'], set: ['tester'] }, // còn u3 → được
      { projectId: 'pA', userId: 'u3', expect: ['admin'], set: null }, // u3 là người cuối → chặn
      { projectId: 'pA', userId: 'u4', expect: ['dev'], set: ['admin'] }, // thêm quản trị mới → được
    ]);
    expect(res.results.map((r) => [r.userId, r.status])).toEqual([
      ['u2', 'ok'],
      ['u3', 'skipped'],
      ['u4', 'ok'],
    ]);
    expect(res.results[1]!.reason).toMatch(/không còn quản trị viên nào/);
    const pub = setupMembers({
      perms: ADMIN,
      isPrivate: false,
      state: { pA: [mem('u2', 'admin')] },
    });
    const ok = await pub.service.setMembers('o1', ME, [
      { projectId: 'pA', userId: 'u2', expect: ['admin'], set: null },
    ]);
    expect(ok.results[0]!.status).toBe('ok');
  });

  it('thứ tự cộng dồn: hạ hai quản trị viên cuối liên tiếp → dòng thứ hai bị chặn', async () => {
    const { service } = setupMembers({
      perms: ADMIN,
      isPrivate: true,
      state: { pA: [mem('u2', 'admin'), mem('u3', 'admin')] },
    });
    const res = await service.setMembers('o1', ME, [
      { projectId: 'pA', userId: 'u2', expect: ['admin'], set: ['dev'] },
      { projectId: 'pA', userId: 'u3', expect: ['admin'], set: ['dev'] },
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['ok', 'skipped']);
  });
});

/* ------------------------------ project-teams: direct ≠ nhờ team ------------------------------ */

interface TeamedRole {
  id: string;
  direct?: boolean;
  teams?: Array<{ id: string; name: string }>;
}
const teamed = (id: string, ...roles: TeamedRole[]) => ({
  user: { id },
  isOverride: true,
  roles,
});
const QA = { id: 't-qa', name: 'QA' };

describe('project-teams — vai trò gán trực tiếp vs nhờ team', () => {
  it('"vai trò riêng" = chỉ phần GÁN TRỰC TIẾP: expect so với phần direct, vai trò nhờ team không tính', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: {
        pA: [
          teamed('u1', { id: 'dev', direct: true }, { id: 'tester', direct: false, teams: [QA] }),
        ],
      },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: ['dev'], set: ['dev', 'designer'] },
    ]);
    expect(res.results[0]).toMatchObject({
      status: 'ok',
      before: ['dev'],
      after: ['dev', 'designer'],
    });
    expect(members.setProjectRoles).toHaveBeenCalledWith(
      'o1',
      'pA',
      'u1',
      ['dev', 'designer'],
      'me',
    );
    // expect = cả vai trò nhờ team (cách cũ) giờ bị coi là đã đổi
    const stale = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: ['dev', 'tester'], set: ['dev', 'designer'] },
    ]);
    expect(stale.results[0]!.status).toBe('skipped');
  });

  it('THÊM cho người chỉ có vai trò nhờ team: expect null, đặt vai trò trực tiếp (vai trò nhờ team không bị đụng); không bị coi là "đã có"', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: { pA: [teamed('u1', { id: 'tester', direct: false, teams: [QA] })] },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: null, set: ['tester'] }, // cùng vai trò, nhưng đặt TRỰC TIẾP
    ]);
    expect(res.results[0]).toMatchObject({ status: 'ok', before: null, after: ['tester'] });
    expect(members.setProjectRoles).toHaveBeenCalledWith('o1', 'pA', 'u1', ['tester'], 'me');
  });

  it('GỠ người chỉ có vai trò nhờ team: bỏ qua, nói rõ "chỉ có quyền qua team QA", KHÔNG gọi MembersService', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: { pA: [teamed('u1', { id: 'tester', direct: false, teams: [QA] })] },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: null, set: null },
    ]);
    expect(res.results[0]!.status).toBe('skipped');
    expect(res.results[0]!.reason).toMatch(/chỉ có quyền qua team QA/);
    expect(members.clearProjectOverride).not.toHaveBeenCalled();
  });

  it('GỠ phần trực tiếp khi còn vai trò nhờ team: ok nhưng báo stillViaTeams; Hoàn tác khôi phục đúng phần trực tiếp', async () => {
    const { service, members } = setupMembers({
      perms: ADMIN,
      state: {
        pA: [
          teamed('u1', { id: 'dev', direct: true }, { id: 'tester', direct: false, teams: [QA] }),
        ],
      },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: ['dev'], set: null },
    ]);
    expect(res.results[0]).toMatchObject({
      status: 'ok',
      before: ['dev'],
      after: null,
      stillViaTeams: ['QA'],
    });
    expect(members.clearProjectOverride).toHaveBeenCalledTimes(1);
    // Hoàn tác (lúc này người đó chỉ còn vai trò nhờ team): expect null → đặt lại ['dev']
    const second = setupMembers({
      perms: ADMIN,
      state: { pA: [teamed('u1', { id: 'tester', direct: false, teams: [QA] })] },
    });
    const undo = await second.service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: null, set: ['dev'] },
    ]);
    expect(undo.results[0]).toMatchObject({ status: 'ok', after: ['dev'] });
    expect(undo.results[0]).not.toHaveProperty('stillViaTeams');
  });

  it('gỡ phần trực tiếp mà KHÔNG còn nhờ team → không có stillViaTeams', async () => {
    const { service } = setupMembers({
      perms: ADMIN,
      state: { pA: [teamed('u1', { id: 'dev', direct: true })] },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: ['dev'], set: null },
    ]);
    expect(res.results[0]).not.toHaveProperty('stillViaTeams');
  });

  it('quản trị dự án nhờ team vẫn tính là quản trị: gỡ phần trực tiếp không phải "mất quản trị cuối" ở dự án riêng tư', async () => {
    const { service } = setupMembers({
      perms: ADMIN,
      isPrivate: true,
      // MỘT vai trò admin vừa gán trực tiếp vừa có nhờ team QA
      state: { pA: [teamed('u1', { id: 'admin', direct: true, teams: [QA] })] },
    });
    const res = await service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: ['admin'], set: null },
    ]);
    expect(res.results[0]).toMatchObject({ status: 'ok', stillViaTeams: ['QA'] });
    // không có phần nhờ team → vẫn bị chặn như trước
    const alone = setupMembers({
      perms: ADMIN,
      isPrivate: true,
      state: { pA: [teamed('u1', { id: 'admin', direct: true })] },
    });
    const blocked = await alone.service.setMembers('o1', user(), [
      { projectId: 'pA', userId: 'u1', expect: ['admin'], set: null },
    ]);
    expect(blocked.results[0]!.status).toBe('skipped');
  });
});
