import { describe, expect, it } from 'vitest';
import type { MemberDto, RoleRefDto } from '@tirapro/types';
import {
  isTeamOnlyMember,
  memberHasDirectRoles,
  memberTeamNames,
  roleSourceOf,
  unlinkImpact,
} from './roleSource';

const role = (id: string, over: Partial<RoleRefDto> = {}): RoleRefDto => ({
  id,
  name: id,
  color: null,
  ...over,
});
const QA = { id: 't1', name: 'QA' };
const DEV = { id: 't2', name: 'Dev' };
const row = (
  roles: RoleRefDto[],
  isOverride = true,
): Pick<MemberDto, 'roles' | 'isOverride' | 'user'> => ({
  roles,
  isOverride,
  user: { displayName: 'An' } as MemberDto['user'],
});

describe('roleSourceOf', () => {
  it('thành viên không có ghi đè → không có nhãn nguồn (hàng đã có thẻ "mặc định")', () => {
    expect(roleSourceOf(role('r'), row([role('r')], false))).toBeNull();
  });
  it('trực tiếp / qua team / vừa trực tiếp vừa nhờ team / mặc định theo tổ chức', () => {
    const m = row([
      role('a', { direct: true }),
      role('b', { direct: false, teams: [QA] }),
      role('c', { direct: true, teams: [QA, DEV] }),
      role('d'),
    ]);
    expect(roleSourceOf(m.roles[0]!, m)).toMatchObject({ kind: 'direct', label: 'trực tiếp' });
    expect(roleSourceOf(m.roles[1]!, m)).toMatchObject({ kind: 'team', label: 'qua Team QA' });
    expect(roleSourceOf(m.roles[2]!, m)).toMatchObject({
      kind: 'direct',
      label: 'trực tiếp + qua Team QA, Dev',
    });
    expect(roleSourceOf(m.roles[3]!, m)).toMatchObject({
      kind: 'orgDefault',
      label: 'mặc định theo tổ chức',
    });
  });
  it('ghi đè cũ (không vai trò nào có thông tin nguồn) = trực tiếp, không nhầm là mặc định', () => {
    const m = row([role('a')]);
    expect(roleSourceOf(m.roles[0]!, m)).toMatchObject({ kind: 'direct' });
    expect(memberHasDirectRoles(m)).toBe(true);
  });
});

describe('thành viên chỉ nhờ team', () => {
  const teamOnly = row([role('b', { direct: false, teams: [QA] }), role('d')]);
  it('isTeamOnlyMember / memberHasDirectRoles / memberTeamNames', () => {
    expect(isTeamOnlyMember(teamOnly)).toBe(true);
    expect(memberHasDirectRoles(teamOnly)).toBe(false);
    expect(memberTeamNames(teamOnly)).toEqual(['QA']);
    const mixed = row([role('a', { direct: true }), role('b', { direct: false, teams: [QA] })]);
    expect(isTeamOnlyMember(mixed)).toBe(false);
    expect(memberHasDirectRoles(mixed)).toBe(true);
    expect(isTeamOnlyMember(row([role('a')], false))).toBe(false);
  });
});

describe('unlinkImpact', () => {
  it('phân biệt người rời hẳn với người chỉ mất bớt (còn vai trò trực tiếp hoặc nhờ team khác)', () => {
    const only = {
      ...row([role('b', { direct: false, teams: [QA] })]),
      user: { displayName: 'Chỉ QA' } as MemberDto['user'],
    };
    const withDirect = {
      ...row([role('a', { direct: true, teams: [QA] })]),
      user: { displayName: 'Có riêng' } as MemberDto['user'],
    };
    const twoTeams = {
      ...row([role('b', { direct: false, teams: [QA, DEV] })]),
      user: { displayName: 'Hai team' } as MemberDto['user'],
    };
    const other = {
      ...row([role('b', { direct: false, teams: [DEV] })]),
      user: { displayName: 'Team khác' } as MemberDto['user'],
    };
    expect(unlinkImpact([only, withDirect, twoTeams, other], QA.id)).toEqual({
      leaving: ['Chỉ QA'],
      reduced: ['Có riêng', 'Hai team'],
    });
  });
});
