import { describe, expect, it } from 'vitest';
// @ts-expect-error — mô-đun .mjs thuần, không có khai báo kiểu
import { findAdminMismatches } from '../scripts/lib/admin-mismatch.mjs';

type U = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  isSystemAdmin: boolean;
  adminOrganizations: string[];
};
const u = (over: Partial<U>): U => ({
  id: 'u',
  email: 'a@x.vn',
  displayName: 'A',
  status: 'ACTIVE',
  isSystemAdmin: false,
  adminOrganizations: [],
  ...over,
});
const run = findAdminMismatches as (users: U[]) => (U & { kind: string })[];

describe('findAdminMismatches', () => {
  it('khớp (cả hai hoặc không cái nào) → không lệch', () => {
    expect(run([u({ isSystemAdmin: true, adminOrganizations: ['w1'] }), u({ id: 'v' })])).toEqual(
      [],
    );
  });
  it('cờ hệ thống mà không Quản trị tổ chức nào → FLAG_WITHOUT_ROLE', () => {
    const r = run([u({ id: 'x', isSystemAdmin: true })]);
    expect(r.map((x) => [x.id, x.kind])).toEqual([['x', 'FLAG_WITHOUT_ROLE']]);
  });
  it('Quản trị tổ chức mà chưa là Quản trị hệ thống → ROLE_WITHOUT_FLAG', () => {
    const r = run([u({ id: 'y', adminOrganizations: ['w1'] })]);
    expect(r.map((x) => [x.id, x.kind])).toEqual([['y', 'ROLE_WITHOUT_FLAG']]);
  });
  it('bỏ qua tài khoản đã vô hiệu hoá và tài khoản hệ thống của tự động hoá', () => {
    expect(
      run([
        u({ status: 'DEACTIVATED', isSystemAdmin: true }),
        u({ email: 'automation@tirapro.local', isSystemAdmin: true }),
      ]),
    ).toEqual([]);
  });
});
