import { describe, expect, it } from 'vitest';
import { matches } from './where-matcher.testutil';
import {
  canDeleteDashboard,
  canEditDashboard,
  dashboardVisibleWhere,
  sortDashboards,
} from './dashboard-access';

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

describe('canEditDashboard / canDeleteDashboard — I1: chỉ chủ sửa, admin chỉ xoá', () => {
  const me = (isAdmin = false) => ({ userId: 'u1', isAdmin });
  const d = (scope: 'PRIVATE' | 'GLOBAL' | 'PROJECT' | 'TEAM', ownerId = 'owner') => ({
    ownerId,
    scope,
  });

  it('chỉ chủ sửa được, ở mọi mức', () => {
    for (const scope of ['PRIVATE', 'GLOBAL', 'PROJECT', 'TEAM'] as const) {
      expect(canEditDashboard({ userId: 'owner', isAdmin: false }, d(scope))).toBe(true);
      expect(canEditDashboard(me(), d(scope))).toBe(false);
    }
  });

  it('admin workspace KHÔNG sửa/đổi mức chia sẻ dashboard người khác', () => {
    for (const scope of ['PRIVATE', 'GLOBAL', 'PROJECT', 'TEAM'] as const) {
      expect(canEditDashboard(me(true), d(scope))).toBe(false);
    }
  });

  it('chủ xoá được; người thường không xoá của người khác', () => {
    expect(canDeleteDashboard({ userId: 'owner', isAdmin: false }, d('PRIVATE'))).toBe(true);
    expect(canDeleteDashboard(me(), d('GLOBAL'))).toBe(false);
    expect(canDeleteDashboard(me(), d('PROJECT'))).toBe(false);
    expect(canDeleteDashboard(me(), d('TEAM'))).toBe(false);
  });

  it('admin xoá được dashboard ĐÃ chia sẻ (kiểm duyệt) nhưng không bao giờ PRIVATE của người khác', () => {
    expect(canDeleteDashboard(me(true), d('GLOBAL'))).toBe(true);
    expect(canDeleteDashboard(me(true), d('PROJECT'))).toBe(true);
    expect(canDeleteDashboard(me(true), d('TEAM'))).toBe(true);
    expect(canDeleteDashboard(me(true), d('PRIVATE'))).toBe(false);
  });
});

describe('dashboardVisibleWhere — đánh giá trên ma trận dữ liệu (không chỉ hình dạng where)', () => {
  const pub = { deletedAt: null, isPrivate: false, memberships: [] };
  const priv = { deletedAt: null, isPrivate: true, memberships: [{ userId: 'pm' }] };
  const team = { deletedAt: null, leadId: 'lead', members: [{ userId: 'tm' }] };
  const row = (over: Record<string, unknown>) => ({
    workspaceId: 'w1',
    deletedAt: null,
    ownerId: 'someone',
    scope: 'GLOBAL',
    project: null,
    team: null,
    ...over,
  });
  const rows = {
    privMine: row({ scope: 'PRIVATE', ownerId: 'u' }),
    privOther: row({ scope: 'PRIVATE', ownerId: 'x' }),
    global: row({ scope: 'GLOBAL' }),
    projPub: row({ scope: 'PROJECT', project: pub }),
    projPriv: row({ scope: 'PROJECT', project: priv }),
    projDeleted: row({ scope: 'PROJECT', project: { ...pub, deletedAt: new Date() } }),
    teamD: row({ scope: 'TEAM', team }),
    teamDeleted: row({ scope: 'TEAM', team: { ...team, deletedAt: new Date() } }),
    deletedDash: row({ scope: 'GLOBAL', deletedAt: new Date() }),
    otherWs: row({ scope: 'GLOBAL', workspaceId: 'w2' }),
  };
  const visibleFor = (userId: string, isAdmin = false) => {
    const projectVisible = isAdmin
      ? {}
      : { OR: [{ isPrivate: false }, { memberships: { some: { userId } } }] };
    const where = dashboardVisibleWhere({ userId, isAdmin }, 'w1', projectVisible);
    return Object.entries(rows)
      .filter(([, r]) => matches(r, where as Record<string, unknown>))
      .map(([k]) => k)
      .sort();
  };

  it('người lạ: chỉ GLOBAL + PROJECT công khai (không PRIVATE, không dự án riêng tư, không nhóm)', () => {
    expect(visibleFor('stranger')).toEqual(['global', 'projPub']);
  });

  it('chủ thấy thêm bản PRIVATE của mình', () => {
    expect(visibleFor('u')).toEqual(['global', 'privMine', 'projPub']);
  });

  it('thành viên dự án riêng tư thấy dashboard của dự án đó; dự án đã xoá thì không', () => {
    expect(visibleFor('pm')).toEqual(['global', 'projPriv', 'projPub']);
  });

  it('thành viên và trưởng nhóm thấy dashboard TEAM; nhóm đã xoá thì không', () => {
    expect(visibleFor('tm')).toEqual(['global', 'projPub', 'teamD']);
    expect(visibleFor('lead')).toEqual(['global', 'projPub', 'teamD']);
  });

  it('admin: mọi GLOBAL/PROJECT/TEAM còn sống; KHÔNG có PRIVATE của người khác; không có dashboard/dự án/nhóm đã xoá', () => {
    expect(visibleFor('adm', true)).toEqual(['global', 'projPriv', 'projPub', 'teamD']);
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
