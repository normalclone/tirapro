import { describe, expect, it } from 'vitest';
import { dashboardInputSchema, DASHBOARD_LIMITS } from '@tirapro/shared';
import {
  addWidget,
  draftIssues,
  insertWidget,
  isDirty,
  moveWidget,
  normalizeOrder,
  removeWidget,
  resizeWidget,
  shareValidation,
  toDashboardBody,
  updateWidget,
  type DashboardDraft,
  type DraftWidget,
} from './layoutOps';
import { WIDGET_REGISTRY } from './registry';

const w = (id: string, order: number, over: Partial<DraftWidget> = {}): DraftWidget => ({
  id,
  type: 'TOP_RISKS',
  title: id,
  config: {},
  position: { order, w: 1 },
  ...over,
});
const ids = (list: DraftWidget[]) => list.map((x) => x.id);
const orders = (list: DraftWidget[]) => list.map((x) => x.position.order);

describe('moveWidget', () => {
  const l = [w('a', 0), w('b', 1), w('c', 2)];

  it('đổi chỗ và đánh lại order liên tục 0..n-1', () => {
    expect(ids(moveWidget(l, 'a', 'c'))).toEqual(['b', 'c', 'a']);
    expect(orders(moveWidget(l, 'a', 'c'))).toEqual([0, 1, 2]);
    expect(ids(moveWidget(l, 'c', 'a'))).toEqual(['c', 'a', 'b']);
  });

  it('theo `order` chứ không theo thứ tự mảng; id lạ hoặc thả lên chính nó → giữ nguyên', () => {
    const shuffled = [w('c', 2), w('a', 0), w('b', 1)];
    expect(ids(moveWidget(shuffled, 'a', 'b'))).toEqual(['b', 'a', 'c']);
    expect(moveWidget(l, 'a', 'a')).toBe(l);
    expect(moveWidget(l, 'zzz', 'a')).toBe(l);
    expect(moveWidget(l, 'a', 'zzz')).toBe(l);
  });

  it('không đổi mảng gốc', () => {
    moveWidget(l, 'a', 'c');
    expect(ids(l)).toEqual(['a', 'b', 'c']);
  });
});

describe('normalizeOrder', () => {
  it('sắp theo order rồi đánh lại 0..n-1 (order thủng hoặc trùng cũng gọn lại)', () => {
    const out = normalizeOrder([w('x', 7), w('y', 2), w('z', 2)]);
    expect(ids(out)).toEqual(['y', 'z', 'x']);
    expect(orders(out)).toEqual([0, 1, 2]);
  });
});

describe('resizeWidget / removeWidget / updateWidget', () => {
  const l = [w('a', 0), w('b', 1), w('c', 2)];

  it('resizeWidget chỉ nhận 1|2|3', () => {
    expect(resizeWidget(l, 'b', 3)[1]!.position.w).toBe(3);
    expect(resizeWidget(l, 'b', 4 as never)).toBe(l);
    expect(resizeWidget(l, 'b', 0 as never)).toBe(l);
    expect(resizeWidget(l, 'zzz', 2)).toBe(l);
  });

  it('removeWidget gỡ ô và đánh lại order', () => {
    const out = removeWidget(l, 'b');
    expect(ids(out)).toEqual(['a', 'c']);
    expect(orders(out)).toEqual([0, 1]);
  });

  it('insertWidget (Hoàn tác) đặt ô về đúng vị trí cũ', () => {
    const out = insertWidget(removeWidget(l, 'b'), l[1]!, 1);
    expect(ids(out)).toEqual(['a', 'b', 'c']);
    expect(orders(out)).toEqual([0, 1, 2]);
  });

  it('updateWidget sửa tiêu đề/cấu hình của đúng một ô', () => {
    const out = updateWidget(l, 'b', { title: 'Mới', config: { k: 1 } });
    expect(out[1]).toMatchObject({ title: 'Mới', config: { k: 1 } });
    expect(out[0]).toBe(l[0]);
  });
});

describe('addWidget', () => {
  it('thêm vào cuối, dùng tiêu đề/cấu hình/cỡ mặc định của loại, đánh dấu ô mới', () => {
    const out = addWidget([w('a', 0)], 'BURNDOWN', () => 'new-1');
    const added = out[1]!;
    expect(added).toMatchObject({
      id: 'new-1',
      isNew: true,
      type: 'BURNDOWN',
      title: WIDGET_REGISTRY.BURNDOWN.defaultTitle,
      config: { projectId: '' },
      position: { order: 1, w: WIDGET_REGISTRY.BURNDOWN.defaultW },
    });
  });

  it('cấu hình mặc định được sao chép (sửa ô không làm bẩn danh mục)', () => {
    const out = addWidget([], 'ISSUE_LIST', () => 'n');
    out[0]!.config.jql = 'x';
    expect(WIDGET_REGISTRY.ISSUE_LIST.defaultConfig.jql).not.toBe('x');
  });

  it(`đủ ${DASHBOARD_LIMITS.widgetsPerDashboard} ô thì không thêm nữa`, () => {
    const full = Array.from({ length: DASHBOARD_LIMITS.widgetsPerDashboard }, (_, i) =>
      w(`w${i}`, i),
    );
    expect(addWidget(full, 'TOP_RISKS')).toBe(full);
  });
});

describe('isDirty', () => {
  const base: DashboardDraft = {
    name: 'D',
    description: '',
    scope: 'PRIVATE',
    projectId: '',
    teamId: '',
    widgets: [w('a', 0, { config: { x: 1, y: 2 } }), w('b', 1)],
  };
  const clone = (): DashboardDraft => structuredClone(base);

  it('false khi chỉ khác tham chiếu (hoặc thứ tự khoá trong config)', () => {
    expect(isDirty(base, clone())).toBe(false);
    const c = clone();
    c.widgets[0]!.config = { y: 2, x: 1 };
    expect(isDirty(base, c)).toBe(false);
  });

  it('true khi đổi thứ tự / cỡ / cấu hình / tiêu đề ô', () => {
    expect(isDirty(base, { ...base, widgets: moveWidget(base.widgets, 'a', 'b') })).toBe(true);
    expect(isDirty(base, { ...base, widgets: resizeWidget(base.widgets, 'a', 2) })).toBe(true);
    expect(
      isDirty(base, { ...base, widgets: updateWidget(base.widgets, 'a', { config: { x: 9 } }) }),
    ).toBe(true);
    expect(
      isDirty(base, { ...base, widgets: updateWidget(base.widgets, 'a', { title: 'Khác' }) }),
    ).toBe(true);
    expect(isDirty(base, { ...base, widgets: removeWidget(base.widgets, 'a') })).toBe(true);
  });

  it('true khi đổi tên / mô tả / mức chia sẻ / dự án / nhóm; "" và null coi như nhau', () => {
    expect(isDirty(base, { ...base, name: 'E' })).toBe(true);
    expect(isDirty(base, { ...base, description: 'mô tả' })).toBe(true);
    expect(isDirty(base, { ...base, scope: 'GLOBAL' })).toBe(true);
    expect(isDirty(base, { ...base, scope: 'PROJECT', projectId: 'p1' })).toBe(true);
    expect(isDirty(base, { ...base, description: null as never })).toBe(false);
  });
});

describe('shareValidation', () => {
  it('PROJECT thiếu projectId, TEAM thiếu teamId, PRIVATE/GLOBAL kèm id → lỗi tiếng Việt', () => {
    expect(shareValidation('PROJECT', '', '')).toMatch(/dự án/);
    expect(shareValidation('TEAM', '', '')).toMatch(/nhóm/);
    expect(shareValidation('PROJECT', 'p', 't')).toMatch(/nhóm/);
    expect(shareValidation('TEAM', 'p', 't')).toMatch(/dự án/);
    expect(shareValidation('PRIVATE', 'p', '')).not.toBeNull();
    expect(shareValidation('GLOBAL', '', 't')).not.toBeNull();
  });

  it('hợp lệ → null', () => {
    expect(shareValidation('PRIVATE', '', '')).toBeNull();
    expect(shareValidation('GLOBAL', '', '')).toBeNull();
    expect(shareValidation('PROJECT', 'p', '')).toBeNull();
    expect(shareValidation('TEAM', '', 't')).toBeNull();
  });
});

describe('draftIssues / toDashboardBody', () => {
  it('ô thiếu cấu hình bắt buộc (BURNDOWN chưa chọn dự án) bị đánh dấu; ô đủ thì không', () => {
    const list = [
      w('a', 0),
      w('b', 1, { type: 'BURNDOWN', config: { projectId: '' } }),
      w('c', 2, { type: 'BURNDOWN', config: { projectId: 'p1' } }),
      w('d', 3, { type: 'ISSUE_LIST', config: { jql: '  ', limit: 10 } }),
    ];
    const issues = draftIssues(list);
    expect(Object.keys(issues).sort()).toEqual(['b', 'd']);
    expect(issues.b).toMatch(/dự án/i);
  });

  it('toDashboardBody bỏ id tạm của ô mới, giữ id của ô cũ và qua được dashboardInputSchema', () => {
    const draft: DashboardDraft = {
      name: ' Của tôi ',
      description: '',
      scope: 'PRIVATE',
      projectId: '',
      teamId: '',
      widgets: [
        w('server-1', 0),
        w('tmp', 1, { isNew: true, type: 'STAT_NUMBER', config: { metric: 'open' } }),
      ],
    };
    const body = toDashboardBody(draft);
    expect(body.widgets[0]!.id).toBe('server-1');
    expect(body.widgets[1]).not.toHaveProperty('id');
    expect(body.projectId).toBeUndefined();
    expect(body.teamId).toBeUndefined();
    expect(dashboardInputSchema.safeParse(body).success).toBe(true);
  });

  it('PROJECT/TEAM gửi đúng một trong hai id', () => {
    const base: DashboardDraft = {
      name: 'D',
      description: 'x',
      scope: 'PROJECT',
      projectId: 'p1',
      teamId: 't1',
      widgets: [],
    };
    expect(toDashboardBody(base)).toMatchObject({ projectId: 'p1' });
    expect(toDashboardBody(base).teamId).toBeUndefined();
    expect(toDashboardBody({ ...base, scope: 'TEAM' }).projectId).toBeUndefined();
    expect(toDashboardBody({ ...base, scope: 'TEAM' }).teamId).toBe('t1');
  });
});
