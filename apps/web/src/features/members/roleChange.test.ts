import { describe, expect, it } from 'vitest';
import type { MemberDto, PermissionKey, RoleRefDto } from '@tirapro/types';
import {
  adminRoleIds,
  applyRolesToMembers,
  beginSave,
  burstBaseline,
  roleIdsWith,
  endSave,
  failSave,
  isLastAdmin,
  lockedRoleReasons,
  LAST_ADMIN_REASON,
  planRoleChange,
  planUndo,
  selfDemoteCopy,
  sameRoleSet,
  succeedSave,
  type RoleSaveStates,
} from './roleChange';

const roles: { id: string; name: string; permissionKeys: PermissionKey[] }[] = [
  { id: 'owner', name: 'OWNER', permissionKeys: ['workspace:admin', 'member:manage'] },
  { id: 'admin', name: 'WORKSPACE_ADMIN', permissionKeys: ['workspace:admin'] },
  { id: 'member', name: 'MEMBER', permissionKeys: ['issue:create'] },
  { id: 'viewer', name: 'VIEWER', permissionKeys: [] },
];
const ADMINS = adminRoleIds(roles);

const mem = (
  id: string,
  roleIds: string[],
  status: 'ACTIVE' | 'DEACTIVATED' | 'INVITED' = 'ACTIVE',
): MemberDto =>
  ({
    membershipId: `m-${id}`,
    user: { id, displayName: id, email: `${id}@x`, status },
    roles: roleIds.map((r) => ({ id: r, name: r })),
  }) as unknown as MemberDto;

describe('adminRoleIds', () => {
  it('chỉ các vai trò có quyền workspace:admin', () => {
    expect([...ADMINS].sort()).toEqual(['admin', 'owner']);
  });
  it('không có vai trò nào → rỗng', () => {
    expect(adminRoleIds([]).size).toBe(0);
  });
});

describe('sameRoleSet', () => {
  it('so sánh như tập hợp, bỏ qua thứ tự', () => {
    expect(sameRoleSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameRoleSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameRoleSet([], [])).toBe(true);
  });
});

describe('isLastAdmin (phản chiếu máy chủ: đếm người KHÁC còn hoạt động giữ vai trò admin)', () => {
  it('chỉ mình họ là admin → đúng', () => {
    const ms = [mem('a', ['admin']), mem('b', ['member'])];
    expect(isLastAdmin(ms, 'a', ADMINS)).toBe(true);
  });
  it('còn admin khác đang hoạt động → sai', () => {
    const ms = [mem('a', ['admin']), mem('b', ['owner'])];
    expect(isLastAdmin(ms, 'a', ADMINS)).toBe(false);
  });
  it('admin khác đã bị vô hiệu hoá không tính', () => {
    const ms = [mem('a', ['admin']), mem('b', ['owner'], 'DEACTIVATED')];
    expect(isLastAdmin(ms, 'a', ADMINS)).toBe(true);
  });
  it('người này không phải admin → sai (không có gì để bảo vệ)', () => {
    const ms = [mem('a', ['member']), mem('b', ['owner'])];
    expect(isLastAdmin(ms, 'a', ADMINS)).toBe(false);
    expect(isLastAdmin([mem('a', ['member'])], 'a', ADMINS)).toBe(false);
  });
  it('không tìm thấy người → sai', () => {
    expect(isLastAdmin([mem('b', ['owner'])], 'zzz', ADMINS)).toBe(false);
  });
});

describe('lockedRoleReasons', () => {
  it('admin cuối cùng chỉ có MỘT vai trò admin → khoá vai trò đó kèm lý do', () => {
    expect(lockedRoleReasons(['admin', 'member'], ADMINS, true)).toEqual({
      admin: LAST_ADMIN_REASON,
    });
  });
  it('có hai vai trò admin → không khoá (bỏ một vẫn còn admin)', () => {
    expect(lockedRoleReasons(['admin', 'owner'], ADMINS, true)).toEqual({});
  });
  it('không phải admin cuối → không khoá', () => {
    expect(lockedRoleReasons(['admin'], ADMINS, false)).toEqual({});
  });
  it('lý do nói rõ cần cấp quyền cho người khác trước', () => {
    expect(LAST_ADMIN_REASON).toMatch(/cuối cùng/);
    expect(LAST_ADMIN_REASON).toMatch(/người khác/);
  });
});

describe('planRoleChange', () => {
  const base = { adminIds: ADMINS, lastAdmin: false, isSelf: false };
  it('không đổi hoặc rỗng → noop', () => {
    expect(planRoleChange({ ...base, prev: ['a'], next: ['a'] })).toEqual({ kind: 'noop' });
    expect(planRoleChange({ ...base, prev: ['a'], next: [] })).toEqual({ kind: 'noop' });
  });
  it('đổi thường → apply', () => {
    expect(planRoleChange({ ...base, prev: ['member'], next: ['member', 'viewer'] })).toEqual({
      kind: 'apply',
      next: ['member', 'viewer'],
      canUndo: true,
    });
  });
  it('admin cuối cùng bị bỏ hết quyền admin → blocked kèm lý do', () => {
    expect(
      planRoleChange({ ...base, lastAdmin: true, prev: ['admin', 'member'], next: ['member'] }),
    ).toEqual({ kind: 'blocked', reason: LAST_ADMIN_REASON });
  });
  it('admin cuối cùng nhưng vẫn giữ một vai trò admin → apply', () => {
    expect(
      planRoleChange({ ...base, lastAdmin: true, prev: ['admin', 'owner'], next: ['owner'] }),
    ).toEqual({ kind: 'apply', next: ['owner'], canUndo: true });
  });
  it('tự bỏ quyền admin của mình (còn admin khác) → confirm', () => {
    expect(planRoleChange({ ...base, isSelf: true, prev: ['admin'], next: ['member'] })).toEqual({
      kind: 'confirm',
      next: ['member'],
      canUndo: false,
      reason: 'admin',
    });
  });
  it('tự đổi vai trò nhưng giữ admin → apply, không hỏi', () => {
    expect(
      planRoleChange({ ...base, isSelf: true, prev: ['admin'], next: ['admin', 'member'] }),
    ).toEqual({ kind: 'apply', next: ['admin', 'member'], canUndo: true });
  });
  it('người khác bị bỏ admin (không phải cuối) → apply, không hỏi', () => {
    expect(planRoleChange({ ...base, prev: ['admin'], next: ['member'] })).toEqual({
      kind: 'apply',
      next: ['member'],
      canUndo: true,
    });
  });
  it('chặn cứng thắng xác nhận khi vừa là chính mình vừa là admin cuối', () => {
    expect(
      planRoleChange({ ...base, isSelf: true, lastAdmin: true, prev: ['admin'], next: ['member'] })
        .kind,
    ).toBe('blocked');
  });
});

describe('roleIdsWith', () => {
  it('vai trò có một quyền cụ thể', () => {
    expect([...roleIdsWith(roles, 'member:manage')]).toEqual(['owner']);
  });
});

describe('planRoleChange — Hoàn tác và quyền quản lý thành viên', () => {
  const MANAGE = roleIdsWith(roles, 'member:manage'); // chỉ 'owner'
  const base = { adminIds: ADMINS, manageIds: MANAGE, lastAdmin: false };
  it('người khác đổi vai trò: có Hoàn tác', () => {
    expect(
      planRoleChange({ ...base, isSelf: false, prev: ['owner'], next: ['member'] }),
    ).toMatchObject({ kind: 'apply', canUndo: true });
  });
  it('tự đổi nhưng giữ quyền: có Hoàn tác, không hỏi', () => {
    expect(
      planRoleChange({ ...base, isSelf: true, prev: ['owner'], next: ['owner', 'member'] }),
    ).toMatchObject({ kind: 'apply', canUndo: true });
  });
  it('tự bỏ quyền admin: hỏi xác nhận và KHÔNG có Hoàn tác (máy chủ đã thu quyền → 403)', () => {
    expect(planRoleChange({ ...base, isSelf: true, prev: ['admin'], next: ['member'] })).toEqual({
      kind: 'confirm',
      next: ['member'],
      canUndo: false,
      reason: 'admin',
    });
  });
  it('tự mất member:manage nhưng còn admin: cũng hỏi và không Hoàn tác', () => {
    expect(planRoleChange({ ...base, isSelf: true, prev: ['owner'], next: ['admin'] })).toEqual({
      kind: 'confirm',
      next: ['admin'],
      canUndo: false,
      reason: 'manage',
    });
  });
  it('người khác mất admin/manage: vẫn Hoàn tác được (người thao tác còn quyền)', () => {
    expect(
      planRoleChange({ ...base, isSelf: false, prev: ['owner'], next: ['member'] }),
    ).toMatchObject({ canUndo: true });
  });
});

describe('selfDemoteCopy — lời nhắc đúng với thứ sắp mất', () => {
  it('mất admin → nói quyền quản trị', () => {
    const c = selfDemoteCopy('admin');
    expect(c.title).toMatch(/quản trị/);
    expect(c.confirmLabel).toMatch(/quản trị/);
  });
  it('chỉ mất member:manage (còn admin) → nói quyền quản lý thành viên, không nói "quản trị"', () => {
    const c = selfDemoteCopy('manage');
    expect(c.title).toBe('Bỏ quyền quản lý thành viên của chính bạn?');
    expect(c.title).not.toMatch(/quản trị/);
    expect(c.description).not.toMatch(/quản trị/);
    expect(c.confirmLabel).not.toMatch(/quản trị/);
  });
});

describe('burstBaseline (Hoàn tác về trước CẢ chuỗi bấm)', () => {
  it('chưa có baseline → lấy bộ trước lần đổi đầu', () => {
    expect(burstBaseline(null, ['a'])).toEqual(['a']);
  });
  it('đã có baseline → giữ nguyên dù bộ trước lần này khác', () => {
    expect(burstBaseline(['a'], ['a', 'b'])).toEqual(['a']);
  });
});

describe('planUndo', () => {
  it('trả bộ vai trò trước đó để khôi phục', () => {
    expect(planUndo(['a', 'b'], ['a'])).toEqual({ roleIds: ['a', 'b'] });
  });
  it('trước = sau (kể cả khác thứ tự) → null, không có gì để hoàn tác', () => {
    expect(planUndo(['a', 'b'], ['b', 'a'])).toBeNull();
  });
  it('bộ trước rỗng → null (máy chủ bắt buộc ≥ 1 vai trò)', () => {
    expect(planUndo([], ['a'])).toBeNull();
  });
});

describe('applyRolesToMembers', () => {
  const refs: RoleRefDto[] = [{ id: 'viewer', name: 'VIEWER', color: null }];
  it('chỉ thay vai trò của đúng người, giữ nguyên các hàng khác và tham chiếu mảng cũ', () => {
    const ms = [mem('a', ['admin']), mem('b', ['member'])];
    const out = applyRolesToMembers(ms, 'a', refs);
    expect(out?.[0]?.roles).toEqual(refs);
    expect(out?.[1]).toBe(ms[1]);
    expect(ms[0]!.roles[0]!.id).toBe('admin'); // không đổi đầu vào
  });
  it('không có dữ liệu → trả nguyên', () => {
    expect(applyRolesToMembers(undefined, 'a', refs)).toBeUndefined();
  });
});

describe('theo dõi lưu nối tiếp (hoàn tác khi lỗi về giá trị máy chủ đã xác nhận)', () => {
  const R = (...ids: string[]): RoleRefDto[] => ids.map((id) => ({ id, name: id }));
  it('lần lỗi cuối cùng → về confirmed; còn lần sau → không hoàn tác', () => {
    const s: RoleSaveStates = new Map();
    beginSave(s, 'u', R('a')); // gieo confirmed = a
    beginSave(s, 'u', R('a', 'b')); // KHÔNG gieo lại (ảnh chụp lạc quan)
    expect(failSave(s, 'u')).toBeNull(); // còn 1 lần sau
    endSave(s, 'u');
    expect(failSave(s, 'u')).toEqual(R('a')); // lần cuối
    endSave(s, 'u');
    expect(s.has('u')).toBe(false);
  });
  it('thành công cập nhật confirmed', () => {
    const s: RoleSaveStates = new Map();
    beginSave(s, 'u', R('a'));
    succeedSave(s, 'u', R('a', 'b'));
    beginSave(s, 'u', R('zzz'));
    expect(failSave(s, 'u')).toBeNull(); // pending 2 → chưa phải lần cuối
    endSave(s, 'u');
    expect(failSave(s, 'u')).toEqual(R('a', 'b'));
  });
  it('người khác nhau độc lập', () => {
    const s: RoleSaveStates = new Map();
    beginSave(s, 'u1', R('a'));
    beginSave(s, 'u2', R('b'));
    expect(failSave(s, 'u1')).toEqual(R('a'));
    expect(failSave(s, 'u2')).toEqual(R('b'));
  });
  it('không có mục → null', () => {
    expect(failSave(new Map(), 'u')).toBeNull();
  });
});
