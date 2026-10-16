import { describe, expect, it } from 'vitest';
import { canEditDashboard, dashboardVisibleWhere, sortDashboards } from './dashboard-access';

const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

describe('dashboardVisibleWhere', () => {
  const where = dashboardVisibleWhere({ userId: 'u1', isAdmin: false }, 'w1', visible);
  const json = JSON.stringify(where);

  it('luôn ràng workspace và chưa xoá', () => {
    expect(where).toMatchObject({ workspaceId: 'w1', deletedAt: null });
  });

  it('gồm: của tôi, GLOBAL, PROJECT qua visibleWhere (dự án sống), TEAM theo thành viên/trưởng nhóm (nhóm sống)', () => {
    expect(json).toContain('"ownerId":"u1"');
    expect(json).toContain('"scope":"GLOBAL"');
    expect(json).toContain('"scope":"PROJECT"');
    expect(json).toContain('"project":{"deletedAt":null,"OR":[{"isPrivate":false}');
    expect(json).toContain('"scope":"TEAM"');
    expect(json).toContain(
      '"team":{"deletedAt":null,"OR":[{"leadId":"u1"},{"members":{"some":{"userId":"u1"}}}]}',
    );
  });

  it('PRIVATE của người khác không có đường nào lọt vào (chỉ qua ownerId)', () => {
    const or = (where as { OR: Array<Record<string, unknown>> }).OR;
    expect(or.some((c) => c.scope === 'PRIVATE')).toBe(false);
    expect(or.filter((c) => c.ownerId).length).toBe(1);
  });

  it('admin: thấy mọi GLOBAL/PROJECT/TEAM còn sống, vẫn không có nhánh PRIVATE của người khác', () => {
    const adminWhere = dashboardVisibleWhere({ userId: 'a1', isAdmin: true }, 'w1', {});
    const s = JSON.stringify(adminWhere);
    expect(s).toContain('"scope":"GLOBAL"');
    expect(s).toContain('"project":{"deletedAt":null}');
    expect(s).toContain('"team":{"deletedAt":null}');
    expect(s).not.toContain('"members"');
    expect(s).not.toContain('"scope":"PRIVATE"');
  });
});

describe('canEditDashboard', () => {
  const base = { ownerId: 'owner', scope: 'GLOBAL' as const, team: null };
  const me = (isAdmin = false) => ({ userId: 'u1', isAdmin });

  it('chủ luôn sửa được', () => {
    expect(canEditDashboard({ userId: 'owner', isAdmin: false }, base, false)).toBe(true);
    expect(
      canEditDashboard({ userId: 'owner', isAdmin: false }, { ...base, scope: 'PRIVATE' }, false),
    ).toBe(true);
  });

  it('người khác không sửa được GLOBAL; admin sửa được GLOBAL', () => {
    expect(canEditDashboard(me(), base, false)).toBe(false);
    expect(canEditDashboard(me(true), base, false)).toBe(true);
  });

  it('admin KHÔNG sửa được PRIVATE của người khác', () => {
    expect(canEditDashboard(me(true), { ...base, scope: 'PRIVATE' }, false)).toBe(false);
  });

  it('PROJECT: project:admin của dự án đó sửa được', () => {
    expect(canEditDashboard(me(), { ...base, scope: 'PROJECT' }, true)).toBe(true);
    expect(canEditDashboard(me(), { ...base, scope: 'PROJECT' }, false)).toBe(false);
  });

  it('TEAM: trưởng nhóm sửa được, thành viên thường thì không', () => {
    const team = { leadId: 'u1' };
    expect(canEditDashboard(me(), { ...base, scope: 'TEAM', team }, false)).toBe(true);
    expect(canEditDashboard(me(), { ...base, scope: 'TEAM', team: { leadId: 'x' } }, false)).toBe(
      false,
    );
    expect(canEditDashboard(me(), { ...base, scope: 'TEAM', team: null }, false)).toBe(false);
  });

  it('isProjectAdmin chỉ có nghĩa với mức PROJECT', () => {
    expect(canEditDashboard(me(), { ...base, scope: 'TEAM', team: null }, true)).toBe(false);
    expect(canEditDashboard(me(), { ...base, scope: 'GLOBAL' }, true)).toBe(false);
  });
});

describe('sortDashboards', () => {
  it('của tôi trước (riêng tư rồi các mức khác), rồi người khác theo mức GLOBAL → PROJECT → TEAM, rồi theo tên', () => {
    const rows = [
      { id: '1', scope: 'TEAM', isMine: false, name: 'A' },
      { id: '2', scope: 'GLOBAL', isMine: false, name: 'B' },
      { id: '3', scope: 'PRIVATE', isMine: true, name: 'Z' },
      { id: '4', scope: 'PROJECT', isMine: false, name: 'C' },
      { id: '5', scope: 'GLOBAL', isMine: false, name: 'A' },
      { id: '6', scope: 'GLOBAL', isMine: true, name: 'M' },
    ] as const;
    expect(sortDashboards([...rows]).map((r) => r.id)).toEqual(['3', '6', '5', '2', '4', '1']);
  });
});
