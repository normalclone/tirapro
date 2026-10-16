import { describe, expect, it } from 'vitest';
import {
  applyEpicFilter,
  buildListProgressMap,
  epicDropId,
  epicProgressLabel,
  parseEpicDropId,
  planEpicAssign,
  epicTaskProgress,
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

describe('một định nghĩa thành viên epic (danh sách = tiến độ = panel = lọc = đếm)', () => {
  const e1 = mk('e1', { t: 'epic' });
  const e2 = mk('e2', { t: 'epic' });
  const p = mk('p');
  const inE1 = mk('inE1', { epicId: 'e1', storyPoints: 2 });
  const viaParent = mk('viaParent', { parentId: 'e1', storyPoints: 3, done: true });
  const underP = mk('underP', { parentId: 'p', epicId: 'e1', storyPoints: 5 }); // cha thường + gắn epic
  const subOfE = mk('subOfE', { t: 'sub', parentId: 'e1', storyPoints: 1 }); // sub-task: không phải thành viên
  const inE2 = mk('inE2', { epicId: 'e2' });
  const all = [e1, e2, p, inE1, viaParent, underP, subOfE, inE2];
  const byId = new Map(all.map((i) => [i.id, i]));
  const ids = (l: { id: string }[]) => l.map((i) => i.id).sort();

  it('sub-task không là thành viên: panel Epic không liệt kê (khớp epicProgress)', () => {
    expect(ids(childrenForPanel(all, e1))).toEqual(['inE1', 'underP', 'viaParent']);
    expect(childrenForPanel(all, e1)).toHaveLength(epicProgress(all, 'e1').totalCount);
  });
  it('tiến độ, panel, lọc và đếm cùng một tập', () => {
    const members = ids(epicMembers(all, 'e1'));
    expect(ids(applyEpicFilter(all, 'e1', byId))).toEqual(members);
    expect(ids(applyEpicFilter(all, 'none', byId))).toContain('subOfE'); // sub-task không thuộc epic nào
    expect(epicCounts(all).get('e1')).toBe(members.length);
    expect(epicProgress(all, 'e1', byId)).toMatchObject({
      totalPoints: 10,
      donePoints: 3,
      totalCount: 3,
    });
  });
  it('việc vừa có cha là epic X vừa epicId = Y: chỉ thuộc MỘT epic (epicId thắng, như ô Epic hiển thị)', () => {
    const dual = mk('dual', { parentId: 'e1', epicId: 'e2' });
    const l = [...all, dual];
    expect(ids(epicMembers(l, 'e2'))).toContain('dual');
    expect(ids(epicMembers(l, 'e1'))).not.toContain('dual');
    expect(ids(childrenForPanel(l, e1))).not.toContain('dual');
  });
  it('epic không là thành viên của chính nó hay của epic khác', () => {
    expect(ids(epicMembers([e1, mk('e3', { t: 'epic', epicId: 'e1' })], 'e1'))).toEqual([]);
  });
  it('epicTaskProgress: cùng đơn vị với epicProgress/panel — theo điểm khi có điểm', () => {
    const p = epicProgress(all, 'e1');
    expect(epicTaskProgress(all, 'e1')).toEqual({
      total: 10,
      done: 3,
      inProgress: 0,
      todo: 7,
      pct: 30,
      unit: 'điểm',
    });
    expect(epicTaskProgress(all, 'e1')).toMatchObject({
      total: p.totalPoints,
      done: p.donePoints,
      pct: p.pct,
    });
  });
  it('epicTaskProgress: epic chưa có điểm nào => theo số việc (như epicProgress)', () => {
    const l = [e1, mk('a', { epicId: 'e1', done: true }), mk('b', { epicId: 'e1' })];
    expect(epicTaskProgress(l, 'e1')).toEqual({
      total: 2,
      done: 1,
      inProgress: 0,
      todo: 1,
      pct: epicProgress(l, 'e1').pct,
      unit: 'việc',
    });
  });
});

describe('buildListProgressMap (dòng/thẻ epic dùng tập thành viên)', () => {
  const e = mk('e', { t: 'epic' });
  const p = mk('p');
  const list = [
    e,
    p,
    mk('a', { epicId: 'e', storyPoints: 2, done: true }),
    mk('b', { parentId: 'p', epicId: 'e', storyPoints: 2 }),
  ];
  it('epic: số việc bằng thành viên (kể cả việc có cha thường); việc thường giữ tiến độ cây', () => {
    const m = buildListProgressMap(list);
    expect(m.get('e')).toMatchObject({ total: 4, done: 2, pct: 50, unit: 'điểm' });
    expect(m.get('p')).toMatchObject({ total: 1 });
  });
  it('epic không có thành viên => không có thanh', () =>
    expect(buildListProgressMap([e]).has('e')).toBe(false));
});

describe('epicProgressLabel', () => {
  const p = { donePoints: 5, totalPoints: 13, doneCount: 1, totalCount: 4, pct: 38 };
  it('có điểm: x/y điểm · n việc', () => expect(epicProgressLabel(p)).toBe('5/13 điểm · 4 việc'));
  it('chưa có điểm: n/m việc', () =>
    expect(
      epicProgressLabel({ ...p, donePoints: 0, totalPoints: 0, doneCount: 2, totalCount: 4 }),
    ).toBe('2/4 việc'));
});

describe('epic drop id', () => {
  it('khứ hồi', () => {
    expect(parseEpicDropId(epicDropId('e1'))).toBe('e1');
    expect(parseEpicDropId(epicDropId('none'))).toBe('none');
  });
  it('id không phải epic => null (id sprint/backlog/dòng việc)', () => {
    expect(parseEpicDropId('backlog')).toBeNull();
    expect(parseEpicDropId('cm1abc')).toBeNull();
  });
});

describe('planEpicAssign', () => {
  const e1 = mk('e1', { t: 'epic' });
  const e2 = mk('e2', { t: 'epic' });
  const s = mk('s');
  const inE1 = mk('i1', { epicId: 'e1' });
  const childOfE1 = mk('c1', { parentId: 'e1' });
  const byId = new Map([e1, e2, s, inE1, childOfE1].map((i) => [i.id, i]));

  it('gắn việc chưa thuộc epic', () =>
    expect(planEpicAssign(s, 'e1', byId)).toEqual({
      kind: 'set',
      patch: { epicId: 'e1' },
      restore: { epicId: null },
    }));
  it('đã thuộc đúng epic đó => bỏ qua', () =>
    expect(planEpicAssign(inE1, 'e1', byId)).toEqual({ kind: 'ignore' }));
  it('con trực tiếp của epic đó cũng là đã thuộc => bỏ qua', () =>
    expect(planEpicAssign(childOfE1, 'e1', byId)).toEqual({ kind: 'ignore' }));
  it('đổi epic', () =>
    expect(planEpicAssign(inE1, 'e2', byId)).toEqual({
      kind: 'set',
      patch: { epicId: 'e2' },
      restore: { epicId: 'e1' },
    }));
  it('"Không thuộc epic": gỡ epicId; việc chưa thuộc epic nào => bỏ qua', () => {
    expect(planEpicAssign(inE1, 'none', byId)).toEqual({
      kind: 'set',
      patch: { epicId: null },
      restore: { epicId: 'e1' },
    });
    expect(planEpicAssign(s, 'none', byId)).toEqual({ kind: 'ignore' });
  });
  it('con trực tiếp của epic X chuyển sang Y: gỡ luôn parentId, Hoàn tác giữ cả hai', () =>
    expect(planEpicAssign(childOfE1, 'e2', byId)).toEqual({
      kind: 'set',
      patch: { epicId: 'e2', parentId: null },
      restore: { epicId: null, parentId: 'e1' },
    }));
  it('con trực tiếp của epic gỡ khỏi epic: gỡ parentId', () =>
    expect(planEpicAssign(childOfE1, 'none', byId)).toEqual({
      kind: 'set',
      patch: { epicId: null, parentId: null },
      restore: { epicId: null, parentId: 'e1' },
    }));
  it('việc có cha thường giữ nguyên cha khi đổi epic', () => {
    const p = mk('p');
    const x = mk('x', { parentId: 'p', epicId: 'e1' });
    const m = new Map([e1, e2, p, x].map((i) => [i.id, i]));
    expect(planEpicAssign(x, 'e2', m)).toEqual({
      kind: 'set',
      patch: { epicId: 'e2' },
      restore: { epicId: 'e1' },
    });
  });
  describe('ca hiếm: cha là epic X nhưng epicId = Y (thuộc Y theo định nghĩa đã chọn)', () => {
    const dual = mk('d', { parentId: 'e1', epicId: 'e2' });
    const m = new Map([e1, e2, dual].map((i) => [i.id, i]));
    it('thả vào Y (đã thuộc) => bỏ qua', () =>
      expect(planEpicAssign(dual, 'e2', m)).toEqual({ kind: 'ignore' }));
    it('thả vào X => gắn X, gỡ parentId; Hoàn tác giữ cả hai', () =>
      expect(planEpicAssign(dual, 'e1', m)).toEqual({
        kind: 'set',
        patch: { epicId: 'e1', parentId: null },
        restore: { epicId: 'e2', parentId: 'e1' },
      }));
    it('thả vào "Không thuộc epic" => gỡ cả epicId lẫn parentId; Hoàn tác giữ cả hai', () =>
      expect(planEpicAssign(dual, 'none', m)).toEqual({
        kind: 'set',
        patch: { epicId: null, parentId: null },
        restore: { epicId: 'e2', parentId: 'e1' },
      }));
  });
  it('epic và sub-task không vào epic', () => {
    expect(planEpicAssign(e1, 'e2', byId)).toMatchObject({ kind: 'reject' });
    expect(planEpicAssign(mk('u', { t: 'sub', parentId: 's' }), 'e1', byId)).toMatchObject({
      kind: 'reject',
    });
  });
});
