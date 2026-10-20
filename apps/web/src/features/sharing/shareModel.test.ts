import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SHARE_KINDS,
  FILTER_SHARE_KINDS,
  filterSharePatch,
  filterShareValue,
  projectOptionsFor,
  sameShare,
  teamOptionsFor,
} from './shareModel';

describe('mức chia sẻ của bộ lọc ↔ giá trị của hộp chia sẻ', () => {
  it('bộ lọc không có nhóm: 3 mức; bảng tổng quan: 4 mức', () => {
    expect(FILTER_SHARE_KINDS).toEqual(['PRIVATE', 'GLOBAL', 'PROJECT']);
    expect(DASHBOARD_SHARE_KINDS).toEqual(['PRIVATE', 'GLOBAL', 'PROJECT', 'TEAM']);
  });
  it('đọc: PRIVATE / WORKSPACE / PROJECT+dự án', () => {
    expect(filterShareValue({ visibility: 'PRIVATE', sharedProjectId: null })).toEqual({
      scope: 'PRIVATE',
      projectId: '',
      teamId: '',
    });
    expect(filterShareValue({ visibility: 'WORKSPACE', sharedProjectId: null }).scope).toBe(
      'GLOBAL',
    );
    expect(filterShareValue({ visibility: 'PROJECT', sharedProjectId: 'p1' })).toEqual({
      scope: 'PROJECT',
      projectId: 'p1',
      teamId: '',
    });
  });
  it('PROJECT chưa gắn dự án (dữ liệu cũ) = máy chủ cho cả không gian thấy → hộp hiện đúng "Cả không gian"', () => {
    expect(filterShareValue({ visibility: 'PROJECT', sharedProjectId: null }).scope).toBe('GLOBAL');
  });
  it('ghi: luôn gửi CẢ visibility lẫn sharedProjectId (đổi sang mức khác thì bỏ dự án cũ)', () => {
    expect(filterSharePatch({ scope: 'PRIVATE', projectId: 'p1', teamId: '' })).toEqual({
      visibility: 'PRIVATE',
      sharedProjectId: null,
    });
    expect(filterSharePatch({ scope: 'GLOBAL', projectId: '', teamId: '' })).toEqual({
      visibility: 'WORKSPACE',
      sharedProjectId: null,
    });
    expect(filterSharePatch({ scope: 'PROJECT', projectId: 'p2', teamId: '' })).toEqual({
      visibility: 'PROJECT',
      sharedProjectId: 'p2',
    });
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
