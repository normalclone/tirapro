import { describe, expect, it } from 'vitest';
import { DASHBOARD_SHARE_KINDS, projectOptionsFor, sameShare, teamOptionsFor } from './shareModel';

describe('mức chia sẻ của bảng tổng quan', () => {
  it('bảng tổng quan: 4 mức (bộ lọc đã lưu có hộp chia sẻ riêng nhiều dự án + người)', () => {
    expect(DASHBOARD_SHARE_KINDS).toEqual(['PRIVATE', 'GLOBAL', 'PROJECT', 'TEAM']);
  });
  it('sameShare so cả ba trường', () => {
    const a = { scope: 'PROJECT', projectId: 'p', teamId: '' } as const;
    expect(sameShare(a, { ...a })).toBe(true);
    expect(sameShare(a, { ...a, projectId: 'q' })).toBe(false);
    expect(sameShare(a, { ...a, scope: 'GLOBAL' })).toBe(false);
    expect(sameShare(a, { ...a, teamId: 't' })).toBe(false);
  });
});

describe('projectOptionsFor / teamOptionsFor — chỉ mời chọn cái người sửa được phép chọn', () => {
  const proj = (id: string, isArchived = false) => ({
    id,
    name: `Dự án ${id}`,
    key: id.toUpperCase(),
    isArchived,
  });
  it('dự án: bỏ dự án đã lưu trữ, TRỪ dự án đang gắn (giá trị hợp lệ không hiện ô trống)', () => {
    const list = [proj('a'), proj('b', true), proj('c', true)];
    expect(projectOptionsFor(list, '').map((o) => o.value)).toEqual(['a']);
    expect(projectOptionsFor(list, 'c').map((o) => o.value)).toEqual(['a', 'c']);
    expect(projectOptionsFor(undefined, '')).toEqual([]);
    expect(projectOptionsFor([proj('a')], '')[0]).toEqual({
      value: 'a',
      label: 'Dự án a',
      hint: 'A',
    });
  });
  const team = (id: string, memberIds: string[], leadId?: string) => ({
    id,
    name: `Nhóm ${id}`,
    lead: leadId ? { id: leadId } : null,
    members: memberIds.map((m) => ({ id: m })),
  });
  it('nhóm: người thường chỉ thấy nhóm mình thuộc (trưởng hoặc thành viên); admin thấy mọi nhóm', () => {
    const teams = [team('t1', ['me']), team('t2', ['x'], 'me'), team('t3', ['x'])];
    const mine = teamOptionsFor(teams, { userId: 'me', isAdmin: false }, '');
    expect(mine.map((o) => o.value)).toEqual(['t1', 't2']);
    expect(teamOptionsFor(teams, { userId: 'me', isAdmin: true }, '').map((o) => o.value)).toEqual([
      't1',
      't2',
      't3',
    ]);
  });
  it('nhóm đang gắn luôn hiện kể cả khi người sửa không còn thuộc nhóm', () => {
    const teams = [team('t1', ['me']), team('t3', ['x'])];
    expect(
      teamOptionsFor(teams, { userId: 'me', isAdmin: false }, 't3').map((o) => o.value),
    ).toEqual(['t1', 't3']);
  });
});
