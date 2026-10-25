import { describe, expect, it } from 'vitest';
import { touchedAdminRoleIds } from './admin-grant';

const ADMINS = new Set(['adminA', 'adminB']);

describe('touchedAdminRoleIds (P-C14)', () => {
  it('thêm vai trò quản trị → bị tính', () => {
    expect(touchedAdminRoleIds(['member'], ['member', 'adminA'], ADMINS)).toEqual(['adminA']);
  });
  it('gỡ vai trò quản trị → bị tính', () => {
    expect(touchedAdminRoleIds(['member', 'adminA'], ['member'], ADMINS)).toEqual(['adminA']);
  });
  it('giữ nguyên vai trò quản trị (chỉ đổi vai trò thường) → không tính', () => {
    expect(touchedAdminRoleIds(['adminA', 'x'], ['adminA', 'y'], ADMINS)).toEqual([]);
  });
  it('đổi quản trị này sang quản trị khác → tính cả hai (gỡ một + thêm một)', () => {
    expect(touchedAdminRoleIds(['adminA'], ['adminB'], ADMINS).sort()).toEqual([
      'adminA',
      'adminB',
    ]);
  });
  it('không có vai trò quản trị nào dính vào → rỗng; thứ tự và trùng lặp không ảnh hưởng', () => {
    expect(touchedAdminRoleIds(['a', 'b'], ['b', 'a', 'a'], ADMINS)).toEqual([]);
    expect(touchedAdminRoleIds([], [], ADMINS)).toEqual([]);
  });
  it('thêm mới từ rỗng (thêm thành viên) với vai trò quản trị → tính', () => {
    expect(touchedAdminRoleIds([], ['adminB'], ADMINS)).toEqual(['adminB']);
  });
});
