import { describe, expect, it } from 'vitest';
import {
  applyEpicFilter,
  childrenForPanel,
  epicChoices,
  epicCounts,
  epicIdOf,
  epicMembers,
  epicProgress,
  parentChoices,
  rollupPoints,
} from './epic';
import { treeParentId } from './issueRefs';
import { mk } from './issueFixture';

describe('treeParentId / epicIdOf', () => {
  it('parentId thắng epicId; không có cả hai => null', () => {
    expect(treeParentId(mk('a', { parentId: 'p1', epicId: 'e1' }))).toBe('p1');
    expect(treeParentId(mk('a', { epicId: 'e1' }))).toBe('e1');
    expect(treeParentId(mk('a'))).toBeNull();
  });
  it('epicIdOf: epicId, hoặc cha là epic, ngược lại null', () => {
    const e = mk('e', { t: 'epic' });
    const s = mk('s', { parentId: 'e' });
    const byId = new Map([e, s].map((i) => [i.id, i]));
    expect(epicIdOf(s, byId)).toBe('e');
    expect(epicIdOf(mk('x', { epicId: 'e9' }), byId)).toBe('e9');
    expect(epicIdOf(mk('y', { parentId: 's' }), byId)).toBeNull();
  });
});

describe('epicProgress (theo điểm)', () => {
  const e = mk('e', { t: 'epic' });
  const list = [
    e,
    mk('a', { epicId: 'e', storyPoints: 5, done: true }),
    mk('b', { parentId: 'e', storyPoints: 3 }),
    mk('c', { epicId: 'e' }), // chưa có điểm
    mk('d', { parentId: 'b', t: 'sub', storyPoints: 2 }), // sub-task (và không phải con trực tiếp): bỏ
    mk('z', { epicId: 'khac', storyPoints: 8 }), // epic khác
  ];
  it('cộng điểm thành viên trực tiếp, bỏ sub-task', () => {
    expect(epicProgress(list, 'e')).toEqual({
      donePoints: 5,
      totalPoints: 8,
      doneCount: 1,
      totalCount: 3,
      pct: 63,
    });
  });
  it('epic chưa có điểm nào => pct theo số việc; không thành viên => 0', () => {
    const l2 = [e, mk('a', { epicId: 'e', done: true }), mk('b', { epicId: 'e' })];
    expect(epicProgress(l2, 'e').pct).toBe(50);
    expect(epicProgress([e], 'e')).toEqual({
      donePoints: 0,
      totalPoints: 0,
      doneCount: 0,
      totalCount: 0,
      pct: 0,
    });
  });
});

describe('rollupPoints (Cây việc, đệ quy)', () => {
  it('cộng con cháu qua epicId lẫn parentId, bỏ sub-task và chính root', () => {
    const list = [
      mk('e', { t: 'epic', storyPoints: 99 }),
      mk('s', { epicId: 'e', storyPoints: 5, done: true }),
      mk('t', { parentId: 's', storyPoints: 3 }),
      mk('u', { parentId: 's', t: 'sub', storyPoints: 1 }),
    ];
    expect(rollupPoints(list, 'e')).toEqual({ donePoints: 5, totalPoints: 8, count: 2 });
  });
});

describe('lựa chọn & lọc theo epic', () => {
  const e1 = mk('e1', { t: 'epic' });
  const e2 = mk('e2', { t: 'epic', done: true });
  const s = mk('s', { epicId: 'e1' });
  const c = mk('c', { parentId: 's' });
  const u = mk('u', { t: 'sub', parentId: 's' });
  const all = [e1, e2, s, c, u];
  const byId = new Map(all.map((i) => [i.id, i]));

  it('epicChoices: chỉ epic, bỏ chính nó, epic chưa xong lên trước', () => {
    expect(epicChoices(all, 'e1').map((i) => i.id)).toEqual(['e2']);
    expect(epicChoices(all, 's').map((i) => i.id)).toEqual(['e1', 'e2']);
  });
  it('parentChoices: không epic/sub-task, không chính nó và con cháu của nó', () => {
    expect(parentChoices(all, 's').map((i) => i.id)).toEqual([]); // c, u là con cháu của s
    expect(
      parentChoices(all, 'n')
        .map((i) => i.id)
        .sort(),
    ).toEqual(['c', 's']);
  });
  it('epicCounts: epic không tính vào "Không thuộc epic"; việc con trực tiếp của việc thuộc epic thì chưa thuộc epic', () => {
    const counts = epicCounts(all);
    expect(counts.get('e1')).toBe(1); // chỉ s
    expect(counts.get('none')).toBe(2); // c, u
  });
  it('applyEpicFilter', () => {
    expect(applyEpicFilter(all, 'e1', byId).map((i) => i.id)).toEqual(['s']);
    expect(applyEpicFilter(all, 'none', byId).map((i) => i.id)).toEqual(['c', 'u']);
    expect(applyEpicFilter(all, null, byId)).toBe(all);
  });
});

describe('childrenForPanel khớp epicProgress', () => {
  const e = mk('e', { t: 'epic' });
  const p = mk('p'); // cha thường
  const both = mk('both', { parentId: 'p', epicId: 'e' }); // cha thường + gắn epic
  const direct = mk('direct', { epicId: 'e' });
  const viaParent = mk('viaParent', { parentId: 'e' });
  const sub = mk('sub', { t: 'sub', parentId: 'p' });
  const list = [e, p, both, direct, viaParent, sub];

  it('epic: gồm việc có cha thường nhưng epicId = epic (cùng tập với epicMembers)', () => {
    const ids = childrenForPanel(list, e)
      .map((i) => i.id)
      .sort();
    expect(ids).toEqual(['both', 'direct', 'viaParent']);
    expect(
      epicMembers(list, 'e')
        .map((i) => i.id)
        .sort(),
    ).toEqual(ids);
  });
  it('số việc của danh sách epic bằng totalCount của epicProgress', () => {
    expect(childrenForPanel(list, e)).toHaveLength(epicProgress(list, 'e').totalCount);
  });
  it('việc thường: con theo cây parentId ?? epicId (việc "both" nằm dưới cha thường p)', () => {
    expect(
      childrenForPanel(list, p)
        .map((i) => i.id)
        .sort(),
    ).toEqual(['both', 'sub']);
  });
});
