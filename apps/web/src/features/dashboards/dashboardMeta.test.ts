import { describe, expect, it } from 'vitest';
import type { CustomDashboardSummaryDto } from '@tirapro/shared';
import { groupDashboards, scopeBadge, scopeDescription } from './dashboardMeta';

const base: CustomDashboardSummaryDto = {
  id: 'd',
  name: 'D',
  description: null,
  scope: 'PRIVATE',
  widgetCount: 0,
  isMine: false,
  canEdit: false,
  canDelete: false,
  owner: { id: 'u', displayName: 'U', avatarUrl: null },
  project: null,
  team: null,
  updatedAt: '2026-10-16T00:00:00.000Z',
};
const d = (id: string, over: Partial<CustomDashboardSummaryDto>): CustomDashboardSummaryDto => ({
  ...base,
  id,
  name: id,
  ...over,
});

describe('scopeBadge / scopeDescription', () => {
  it('mỗi mức có nhãn tiếng Việt, dự án/nhóm kèm mã/tên', () => {
    expect(scopeBadge(base)).toBe('Riêng tư');
    expect(scopeBadge(d('g', { scope: 'GLOBAL' }))).toBe('Cả không gian');
    expect(
      scopeBadge(d('p', { scope: 'PROJECT', project: { id: 'p1', key: 'WEB', name: 'Web' } })),
    ).toBe('Dự án WEB');
    expect(scopeBadge(d('t', { scope: 'TEAM', team: { id: 't1', name: 'QA' } }))).toBe('Nhóm QA');
    expect(scopeDescription(d('g', { scope: 'GLOBAL' }))).toMatch(/không gian/);
  });
});

describe('groupDashboards', () => {
  it('Của tôi trước (mọi mức), rồi Cả không gian, Dự án, Nhóm; bỏ nhóm rỗng', () => {
    const list = [
      d('t1', { scope: 'TEAM', team: { id: 'qa', name: 'QA' } }),
      d('p1', { scope: 'PROJECT', project: { id: 'w', key: 'WEB', name: 'Web' } }),
      d('g1', { scope: 'GLOBAL' }),
      d('m1', { isMine: true, scope: 'GLOBAL' }),
      d('m2', { isMine: true }),
      d('p2', { scope: 'PROJECT', project: { id: 'w', key: 'WEB', name: 'Web' } }),
      d('p3', { scope: 'PROJECT', project: { id: 'a', key: 'APP', name: 'App' } }),
    ];
    const groups = groupDashboards(list);
    expect(groups.map((g) => g.title)).toEqual([
      'Của tôi',
      'Cả không gian',
      'Dự án: APP',
      'Dự án: WEB',
      'Nhóm: QA',
    ]);
    expect(groups[0]!.items.map((x) => x.id)).toEqual(['m1', 'm2']);
    expect(groups[3]!.items.map((x) => x.id)).toEqual(['p1', 'p2']);
  });

  it('danh sách rỗng → không có nhóm', () => {
    expect(groupDashboards([])).toEqual([]);
  });
});
