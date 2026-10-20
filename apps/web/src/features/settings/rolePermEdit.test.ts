import { describe, expect, it } from 'vitest';
import { roleLabel, type MemberDto } from '@tirapro/types';
import {
  applyDesired,
  cloneName,
  grantAdminCopy,
  grantsAdmin,
  groupState,
  groupTargetOn,
  guardRoleEdit,
  hasKey,
  planFlush,
  planPermUndo,
  sameKeySet,
  selfLoss,
  setManyDesired,
  subtractDesired,
  toggleDesired,
  type GuardCtx,
} from './rolePermEdit';

describe('toggleDesired / applyDesired', () => {
  const base = ['a', 'b'];
  it('bật một quyền chưa có, tắt một quyền đang có', () => {
    expect(toggleDesired(base, {}, 'c')).toEqual({ c: true });
    expect(toggleDesired(base, {}, 'a')).toEqual({ a: false });
  });
  it('bấm hai lần = về bản máy chủ → không còn mục nào (tổng thay đổi bằng 0)', () => {
    const once = toggleDesired(base, {}, 'c');
    expect(toggleDesired(base, once, 'c')).toEqual({});
    const off = toggleDesired(base, {}, 'a');
    expect(toggleDesired(base, off, 'a')).toEqual({});
  });
  it('hasKey: bản nháp thắng bản máy chủ', () => {
    expect(hasKey(base, { a: false, c: true }, 'a')).toBe(false);
    expect(hasKey(base, { a: false, c: true }, 'c')).toBe(true);
    expect(hasKey(base, undefined, 'b')).toBe(true);
    expect(hasKey(base, {}, 'z')).toBe(false);
  });
  it('applyDesired giữ thứ tự bản gốc, bỏ quyền tắt, thêm quyền bật ở cuối; không đổi mảng đầu vào', () => {
    const input = ['a', 'b', 'c'];
    expect(applyDesired(input, { b: false, d: true })).toEqual(['a', 'c', 'd']);
    expect(input).toEqual(['a', 'b', 'c']);
  });
  it('setManyDesired đặt cả nhóm, bỏ mục trùng bản máy chủ', () => {
    expect(setManyDesired(['a'], {}, ['a', 'b', 'c'], true)).toEqual({ b: true, c: true });
    expect(setManyDesired(['a', 'b'], { c: true }, ['a', 'b', 'c'], false)).toEqual({
      a: false,
      b: false,
    });
  });
});

describe('subtractDesired (bỏ phần đã gửi khỏi bản nháp)', () => {
  it('bỏ mục đã gửi, giữ mục bấm thêm trong lúc gửi', () => {
    expect(subtractDesired({ a: false, b: true, c: true }, { a: false, b: true })).toEqual({
      c: true,
    });
  });
  it('mục cùng khoá nhưng ĐÃ ĐỔI chiều trong lúc gửi thì giữ (người dùng bấm lại)', () => {
    expect(subtractDesired({ a: true }, { a: false })).toEqual({ a: true });
  });
  it('gửi hết thì rỗng', () => {
    expect(subtractDesired({ a: false }, { a: false })).toEqual({});
  });
});

describe('groupState / groupTargetOn (ô nhóm 3 trạng thái)', () => {
  const keys = ['x:1', 'x:2', 'x:3'];
  const has = (set: string[]) => (k: string) => set.includes(k);
  it('đủ / một phần / không, kèm đếm', () => {
    expect(groupState(keys, has(['x:1', 'x:2', 'x:3']))).toEqual({
      state: 'full',
      count: 3,
      total: 3,
    });
    expect(groupState(keys, has(['x:2']))).toEqual({ state: 'partial', count: 1, total: 3 });
    expect(groupState(keys, has([]))).toEqual({ state: 'none', count: 0, total: 3 });
  });
  it('nhóm rỗng = không (không chia 0)', () => {
    expect(groupState([], has([]))).toEqual({ state: 'none', count: 0, total: 0 });
  });
  it('bấm: đủ → tắt hết; một phần/không → bật hết', () => {
    expect(groupTargetOn('full')).toBe(false);
    expect(groupTargetOn('partial')).toBe(true);
    expect(groupTargetOn('none')).toBe(true);
  });
});

describe('planFlush (kế hoạch gom bấm)', () => {
  it('bản cuối = bản MÁY CHỦ MỚI NHẤT + bấm cục bộ', () => {
    expect(planFlush(['a', 'b'], { a: false, c: true })).toEqual({
      next: ['b', 'c'],
      changed: true,
    });
  });
  it('bản máy chủ vừa đổi trong lúc chờ: các quyền không bấm theo bản mới', () => {
    // người dùng chỉ bấm bật "c"; máy chủ (refetch) đã có thêm "z" → giữ "z"
    expect(planFlush(['a', 'z'], { c: true }).next).toEqual(['a', 'z', 'c']);
  });
  it('không còn gì khác → changed=false (không gửi PATCH thừa)', () => {
    expect(planFlush(['a'], {})).toEqual({ next: ['a'], changed: false });
    expect(planFlush(['a'], { a: true, b: false })).toEqual({ next: ['a'], changed: false });
  });
});

describe('planPermUndo', () => {
  it('khôi phục bộ TRƯỚC chuỗi bấm', () => {
    expect(planPermUndo(['a', 'b'], ['a'])).toEqual({ keys: ['a', 'b'] });
  });
  it('null khi không khác (kể cả khác thứ tự)', () => {
    expect(planPermUndo(['a', 'b'], ['b', 'a'])).toBeNull();
  });
  it('cho phép hoàn tác về bộ RỖNG (máy chủ cho vai trò không quyền)', () => {
    expect(planPermUndo([], ['a'])).toEqual({ keys: [] });
  });
  it('sameKeySet: tập hợp, bỏ qua thứ tự', () => {
    expect(sameKeySet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameKeySet(['a'], ['a', 'b'])).toBe(false);
  });
});

/* ------------------------------ chốt quyền thiết yếu ------------------------------ */

const ADMIN = 'workspace:admin';
const MANAGE = 'member:manage';
const member = (id: string, roleIds: string[], status = 'ACTIVE'): MemberDto =>
  ({
    membershipId: `m-${id}`,
    user: { id, displayName: id, email: id, status },
    roles: roleIds.map((r) => ({ id: r, name: r })),
  }) as MemberDto;

function ctx(over: Partial<GuardCtx> = {}): GuardCtx {
  return {
    role: { id: 'custom' },
    roles: [
      { id: 'sysadmin', permissionKeys: [ADMIN, MANAGE, 'issue:edit'] },
      { id: 'custom', permissionKeys: [ADMIN, MANAGE, 'issue:edit'] },
      { id: 'viewer', permissionKeys: ['issue:edit'] },
    ],
    members: [member('me', ['custom']), member('other', ['sysadmin']), member('v', ['viewer'])],
    selfId: 'me',
    selfIsSystemAdmin: false,
    ...over,
  };
}

describe('guardRoleEdit', () => {
  it('không đụng quyền thiết yếu → ok', () => {
    expect(guardRoleEdit(ctx(), [ADMIN, MANAGE, 'issue:edit'], [ADMIN, MANAGE])).toEqual({
      kind: 'ok',
    });
  });

  it('TỰ mất member:manage (vai trò custom là đường duy nhất của mình) → hỏi xác nhận', () => {
    expect(guardRoleEdit(ctx(), [ADMIN, MANAGE], [ADMIN])).toEqual({
      kind: 'confirm',
      reason: 'manage',
    });
  });

  it('TỰ mất workspace:admin → xác nhận lý do admin (ưu tiên hơn manage)', () => {
    expect(guardRoleEdit(ctx(), [ADMIN, MANAGE], ['issue:edit'])).toEqual({
      kind: 'confirm',
      reason: 'admin',
    });
  });

  it('mình còn quyền qua vai trò khác → không hỏi', () => {
    const c = ctx({ members: [member('me', ['custom', 'sysadmin']), member('v', ['viewer'])] });
    expect(guardRoleEdit(c, [ADMIN, MANAGE], [])).toEqual({ kind: 'ok' });
  });

  it('người khác giữ vai trò → gỡ quyền không cần hỏi mình', () => {
    const c = ctx({ members: [member('x', ['custom']), member('other', ['sysadmin'])] });
    expect(guardRoleEdit(c, [ADMIN, MANAGE], [])).toEqual({ kind: 'ok' });
  });

  it('gỡ workspace:admin khiến KHÔNG còn quản trị viên hoạt động nào → chặn (phản chiếu máy chủ)', () => {
    const c = ctx({ members: [member('x', ['custom']), member('v', ['viewer'])], selfId: 'v' });
    const r = guardRoleEdit(c, [ADMIN, MANAGE], [MANAGE]);
    expect(r.kind).toBe('blocked');
  });

  it('quản trị viên khác đã VÔ HIỆU HOÁ không tính (như máy chủ) → vẫn chặn', () => {
    const c = ctx({
      members: [member('x', ['custom']), member('other', ['sysadmin'], 'DEACTIVATED')],
      selfId: 'zzz',
    });
    expect(guardRoleEdit(c, [ADMIN, MANAGE], [MANAGE]).kind).toBe('blocked');
  });

  it('còn quản trị viên khác hoạt động → gỡ được', () => {
    const c = ctx({
      members: [member('x', ['custom']), member('other', ['sysadmin'])],
      selfId: 'zzz',
    });
    expect(guardRoleEdit(c, [ADMIN, MANAGE], [MANAGE])).toEqual({ kind: 'ok' });
  });

  it('chặn thắng xác nhận (vừa tự mất vừa là admin cuối)', () => {
    const c = ctx({ members: [member('me', ['custom'])] });
    expect(guardRoleEdit(c, [ADMIN, MANAGE], [MANAGE]).kind).toBe('blocked');
  });

  it('admin hệ thống không bao giờ tự mất quyền qua vai trò → không hỏi', () => {
    expect(guardRoleEdit(ctx({ selfIsSystemAdmin: true }), [ADMIN, MANAGE], [])).toEqual({
      kind: 'ok',
    });
  });

  it('danh sách thành viên chưa có → không chặn/hỏi được (lớp gọi phải khoá sửa tới khi có)', () => {
    expect(guardRoleEdit(ctx({ members: undefined }), [ADMIN, MANAGE], [])).toEqual({ kind: 'ok' });
  });

  it('bộ quyền các vai trò khác lấy từ danh sách vai trò, của vai trò đang sửa lấy từ before/after', () => {
    // vai trò "custom" trong danh sách còn cũ (có ADMIN) nhưng after=[]: không được dùng bản cũ để tính "còn quyền"
    const c = ctx({ members: [member('me', ['custom'])], selfId: 'me' });
    expect(guardRoleEdit(c, [ADMIN], [])).toMatchObject({ kind: 'blocked' });
  });
});

describe('selfLoss', () => {
  it('trả "admin" | "manage" | null như guard dùng', () => {
    expect(selfLoss(ctx(), [ADMIN, MANAGE], [ADMIN])).toBe('manage');
    expect(selfLoss(ctx(), [ADMIN, MANAGE], [])).toBe('admin');
    expect(selfLoss(ctx(), [ADMIN, MANAGE], [ADMIN, MANAGE])).toBeNull();
    expect(selfLoss(ctx({ selfIsSystemAdmin: true }), [ADMIN], [])).toBeNull();
  });
});

describe('cloneName', () => {
  it('dùng tên hiển thị tiếng Việt của vai trò hệ thống + hậu tố', () => {
    expect(cloneName('Scrum Master')).toBe(`${roleLabel('Scrum Master')} (bản sao)`);
  });
  it('không vượt 60 ký tự (giới hạn máy chủ)', () => {
    expect(cloneName('x'.repeat(100)).length).toBe(60);
    expect(cloneName('x'.repeat(100)).endsWith(' (bản sao)')).toBe(true);
  });
  it('tên ngắn giữ nguyên + hậu tố', () => {
    expect(cloneName('QA')).toBe('QA (bản sao)');
  });
});

describe('grantsAdmin / grantAdminCopy (bật quyền quản trị cho vai trò)', () => {
  it('chỉ true khi bộ trước KHÔNG có và bộ sau CÓ workspace:admin', () => {
    expect(grantsAdmin(['issue:create'], ['issue:create', 'workspace:admin'])).toBe(true);
    expect(grantsAdmin(['workspace:admin'], ['workspace:admin', 'issue:create'])).toBe(false);
    expect(grantsAdmin(['workspace:admin'], [])).toBe(false);
    expect(grantsAdmin([], ['member:manage'])).toBe(false);
  });
  it('lời nhắc nêu tên vai trò, số người đang giữ và hệ quả "toàn quyền quản trị"', () => {
    const c = grantAdminCopy('QA Lead', 3);
    expect(c.title).toContain('Quản trị không gian làm việc');
    expect(c.description).toContain('"QA Lead"');
    expect(c.description).toContain('3 thành viên');
    expect(c.description).toContain('toàn quyền quản trị');
    expect(c.confirmLabel).toBe('Cấp quyền quản trị');
  });
  it('vai trò chưa ai giữ: nói sẽ áp dụng cho người được gán sau', () => {
    expect(grantAdminCopy('QA Lead', 0).description).toContain('chưa gán cho ai');
  });
});
