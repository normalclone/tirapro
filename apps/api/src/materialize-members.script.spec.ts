import { describe, expect, it } from 'vitest';
// @ts-expect-error — mô-đun .mjs thuần, không có khai báo kiểu
import { selectToMaterialize } from '../scripts/lib/materialize-members.mjs';

const run = selectToMaterialize as (i: {
  activeUserIds: string[];
  memberOnlyIds: string[];
  existingIds: string[];
}) => string[];

describe('selectToMaterialize', () => {
  it('người có hoạt động + là Organization Member + chưa có dòng thành viên → được thêm (khử trùng, sắp xếp)', () => {
    expect(
      run({
        activeUserIds: ['u3', 'u1', 'u3'],
        memberOnlyIds: ['u1', 'u2', 'u3'],
        existingIds: [],
      }),
    ).toEqual(['u1', 'u3']);
  });
  it('đã có ProjectMembership thì bỏ qua (idempotent)', () => {
    expect(
      run({ activeUserIds: ['u1', 'u2'], memberOnlyIds: ['u1', 'u2'], existingIds: ['u1'] }),
    ).toEqual(['u2']);
  });
  it('không có hoạt động → không thêm; Quản trị / Người xem (không nằm trong memberOnly) → không thêm', () => {
    expect(run({ activeUserIds: [], memberOnlyIds: ['u1'], existingIds: [] })).toEqual([]);
    expect(
      run({ activeUserIds: ['admin', 'viewer'], memberOnlyIds: ['u1'], existingIds: [] }),
    ).toEqual([]);
  });
});
