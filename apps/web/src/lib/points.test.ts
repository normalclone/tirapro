import { describe, expect, it } from 'vitest';
import { mk } from './issueFixture';
import {
  CHILD_SPRINT_TIP,
  EPIC_POINTS_TIP,
  ROLLUP_POINTS_TIP,
  hasLoadedChildren,
  isRollupPoints,
  leafPointsSum,
  parentIdSetOf,
  parsePointsOverride,
  pointsRoleOf,
  pointsTip,
} from './points';

describe('leafPointsSum — mọi phép cộng điểm chỉ đếm việc lá', () => {
  const list = [
    mk('e', { t: 'epic', storyPoints: 9 }), // Epic: điểm là tổng → bỏ
    mk('p', { storyPoints: 5 }), // cha của c1, c2 → bỏ
    mk('c1', { parentId: 'p', storyPoints: 2 }),
    mk('c2', { parentId: 'p', storyPoints: 3 }),
    mk('solo', { storyPoints: 4 }),
    mk('none'), // chưa có điểm → 0
  ];
  it('bỏ Epic và việc đang là cha của việc khác trong tập đã nạp', () => {
    expect(leafPointsSum(list)).toBe(2 + 3 + 4);
  });
  it('danh sách con của một khu: truyền tập cha của TOÀN BỘ dữ liệu để cha nằm ngoài vẫn loại đúng', () => {
    const section = list.filter((i) => i.id === 'p' || i.id === 'solo');
    expect(leafPointsSum(section)).toBe(5 + 4); // tự suy từ section: p không có con trong section → bị tính
    expect(leafPointsSum(section, parentIdSetOf(list))).toBe(4); // đúng khi dùng tập cha toàn cục
  });
  it('loại tuỳ chỉnh cấp cao (key null, không phải EPIC) vẫn tính như việc thường', () => {
    const custom = mk('x', { storyPoints: 6 });
    expect(
      leafPointsSum([{ ...custom, type: { ...custom.type, key: null, hierarchyLevel: 1 } }]),
    ).toBe(6);
  });
  it('hasLoadedChildren theo tập cha', () => {
    const ids = parentIdSetOf(list);
    expect(hasLoadedChildren(list[1]!, ids)).toBe(true);
    expect(hasLoadedChildren(list[4]!, ids)).toBe(false);
  });
});

describe('parsePointsOverride — chỉnh tay: số nguyên 0–100, không xoá điểm', () => {
  it('nhận số nguyên (kể cả "3,0" và khoảng trắng)', () => {
    expect(parsePointsOverride('5')).toEqual({ ok: true, value: 5 });
    expect(parsePointsOverride(' 0 ')).toEqual({ ok: true, value: 0 });
    expect(parsePointsOverride('3,0')).toEqual({ ok: true, value: 3 });
    expect(parsePointsOverride('100')).toEqual({ ok: true, value: 100 });
  });
  it('từ chối rỗng (không có "xoá điểm"), số lẻ, âm, chữ, lớn hơn 100', () => {
    for (const bad of ['', '  ', '2.5', '-1', 'abc', '1e2']) {
      expect(parsePointsOverride(bad).ok, bad).toBe(false);
    }
    const big = parsePointsOverride('101');
    expect(big).toEqual({ ok: false, error: 'Điểm tối đa 100' });
  });
});

describe('pointsTip / pointsRoleOf', () => {
  const bug = mk('b', { pointsExplain: 'Bug · Khó · High = 2×3×1.5 = 9' });
  it('việc thường: lời giải thích của máy chủ (có dấu "=")', () => {
    expect(pointsTip(bug, false)).toContain('=');
  });
  it('việc cha: "Tổng điểm việc con"; Epic: tổng điểm các việc trong Epic', () => {
    expect(pointsTip(bug, true)).toContain(ROLLUP_POINTS_TIP);
    expect(pointsTip(mk('e', { t: 'epic' }), false)).toBe(EPIC_POINTS_TIP);
    expect(isRollupPoints(mk('e', { t: 'epic' }), false)).toBe(true);
    expect(isRollupPoints(bug, true)).toBe(true);
    expect(isRollupPoints(bug, false)).toBe(false);
  });
  it('thiếu pointsExplain (dữ liệu cũ): vẫn có câu giải thích chung', () => {
    expect(pointsTip(mk('x'), false)).toContain('Độ khó');
  });
  it('vai trò ô điểm: Quản trị sửa được việc lá; người khác chỉ đọc; cha/Epic luôn là tổng', () => {
    const parents = new Set(['p']);
    expect(pointsRoleOf(mk('leaf'), parents, true)).toBe('edit');
    expect(pointsRoleOf(mk('leaf'), parents, false)).toBe('locked');
    expect(pointsRoleOf(mk('p'), parents, true)).toBe('rollup');
    expect(pointsRoleOf(mk('e', { t: 'epic' }), parents, true)).toBe('rollup');
  });
  it('hằng lời nhắc việc con đi theo sprint của cha', () => {
    expect(CHILD_SPRINT_TIP).toBe('Việc con đi theo sprint của việc cha');
  });
});
