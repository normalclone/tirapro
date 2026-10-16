import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_LIMITS,
  DASHBOARD_WIDGET_TYPES,
  dashboardInputSchema,
  dashboardUpdateSchema,
  widgetInputSchema,
} from './dashboard';

const pos = { order: 0, w: 1 } as const;
const widget = (over: Record<string, unknown> = {}) => ({
  type: 'STAT_NUMBER',
  title: 'Việc mở',
  config: { metric: 'open' },
  position: pos,
  ...over,
});
const dash = (over: Record<string, unknown> = {}) => ({
  name: 'Tuần này',
  scope: 'PRIVATE',
  widgets: [widget()],
  ...over,
});

describe('dashboardInputSchema — luật theo mức chia sẻ', () => {
  it('PRIVATE/GLOBAL hợp lệ khi không có projectId/teamId', () => {
    expect(dashboardInputSchema.safeParse(dash()).success).toBe(true);
    expect(dashboardInputSchema.safeParse(dash({ scope: 'GLOBAL' })).success).toBe(true);
  });

  it('PRIVATE/GLOBAL cấm projectId và teamId', () => {
    expect(dashboardInputSchema.safeParse(dash({ projectId: 'p1' })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dash({ scope: 'GLOBAL', teamId: 't1' })).success).toBe(
      false,
    );
  });

  it('PROJECT thiếu projectId → từ chối; có projectId → ok; kèm teamId → từ chối', () => {
    expect(dashboardInputSchema.safeParse(dash({ scope: 'PROJECT' })).success).toBe(false);
    expect(
      dashboardInputSchema.safeParse(dash({ scope: 'PROJECT', projectId: 'p1' })).success,
    ).toBe(true);
    expect(
      dashboardInputSchema.safeParse(dash({ scope: 'PROJECT', projectId: 'p1', teamId: 't1' }))
        .success,
    ).toBe(false);
  });

  it('TEAM thiếu teamId → từ chối; kèm projectId → từ chối', () => {
    expect(dashboardInputSchema.safeParse(dash({ scope: 'TEAM' })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dash({ scope: 'TEAM', teamId: 't1' })).success).toBe(
      true,
    );
    expect(
      dashboardInputSchema.safeParse(dash({ scope: 'TEAM', teamId: 't1', projectId: 'p1' }))
        .success,
    ).toBe(false);
  });

  it('tên bắt buộc ≤120; tối đa 12 ô', () => {
    expect(dashboardInputSchema.safeParse(dash({ name: '  ' })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dash({ name: 'x'.repeat(121) })).success).toBe(false);
    const many = Array.from({ length: DASHBOARD_LIMITS.widgetsPerDashboard + 1 }, () => widget());
    expect(dashboardInputSchema.safeParse(dash({ widgets: many })).success).toBe(false);
  });

  it('cập nhật bắt buộc updatedAt (phát hiện ghi đè)', () => {
    expect(dashboardUpdateSchema.safeParse(dash()).success).toBe(false);
    expect(
      dashboardUpdateSchema.safeParse(dash({ updatedAt: '2026-10-16T01:00:00.000Z' })).success,
    ).toBe(true);
  });
});

describe('widgetInputSchema', () => {
  it('loại chưa hỗ trợ (CFD…) → "Chưa hỗ trợ"', () => {
    for (const type of ['CFD', 'SPRINT_REPORT', 'CONTROL_CHART', 'AI_INSIGHT']) {
      const r = widgetInputSchema.safeParse(widget({ type, config: {} }));
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain('Chưa hỗ trợ');
    }
  });

  it('9 loại hỗ trợ', () => {
    expect([...DASHBOARD_WIDGET_TYPES].sort()).toEqual(
      [
        'BURNDOWN',
        'CREATED_VS_RESOLVED',
        'ISSUE_LIST',
        'OVERLOAD',
        'PIE_BY_FIELD',
        'SLOW_GOALS',
        'STAT_NUMBER',
        'TOP_RISKS',
        'VELOCITY',
      ].sort(),
    );
  });

  it('ISSUE_LIST thiếu jql → từ chối; jql >500 → từ chối; limit 5–20', () => {
    const base = { type: 'ISSUE_LIST', title: 'Việc của tôi', position: pos };
    expect(widgetInputSchema.safeParse({ ...base, config: {} }).success).toBe(false);
    expect(widgetInputSchema.safeParse({ ...base, config: { jql: 'x'.repeat(501) } }).success).toBe(
      false,
    );
    expect(
      widgetInputSchema.safeParse({ ...base, config: { jql: 'a = 1', limit: 4 } }).success,
    ).toBe(false);
    expect(
      widgetInputSchema.safeParse({ ...base, config: { jql: 'a = 1', limit: 21 } }).success,
    ).toBe(false);
    const ok = widgetInputSchema.safeParse({ ...base, config: { jql: 'a = 1' } });
    expect(ok.success && ok.data.config).toEqual({ jql: 'a = 1', limit: 10 });
  });

  it('position.w chỉ 1|2|3; order số nguyên ≥ 0', () => {
    expect(widgetInputSchema.safeParse(widget({ position: { order: 0, w: 4 } })).success).toBe(
      false,
    );
    expect(widgetInputSchema.safeParse(widget({ position: { order: -1, w: 1 } })).success).toBe(
      false,
    );
    expect(widgetInputSchema.safeParse(widget({ position: { order: 2, w: 3 } })).success).toBe(
      true,
    );
  });

  it('BURNDOWN/VELOCITY bắt buộc projectId; STAT_NUMBER/PIE/CREATED_VS_RESOLVED tuỳ chọn', () => {
    expect(widgetInputSchema.safeParse(widget({ type: 'BURNDOWN', config: {} })).success).toBe(
      false,
    );
    expect(
      widgetInputSchema.safeParse(widget({ type: 'VELOCITY', config: { projectId: 'p1' } }))
        .success,
    ).toBe(true);
    expect(
      widgetInputSchema.safeParse(widget({ type: 'PIE_BY_FIELD', config: { field: 'status' } }))
        .success,
    ).toBe(true);
    expect(
      widgetInputSchema.safeParse(widget({ type: 'CREATED_VS_RESOLVED', config: {} })).success,
    ).toBe(true);
  });

  it('STAT_NUMBER chỉ nhận metric trong danh sách; PIE chỉ nhận field trong danh sách', () => {
    expect(widgetInputSchema.safeParse(widget({ config: { metric: 'zzz' } })).success).toBe(false);
    expect(
      widgetInputSchema.safeParse(widget({ type: 'PIE_BY_FIELD', config: { field: 'assignee' } }))
        .success,
    ).toBe(false);
  });

  it('TOP_RISKS/SLOW_GOALS/OVERLOAD không cần cấu hình; khoá lạ bị bỏ khỏi config', () => {
    for (const type of ['TOP_RISKS', 'SLOW_GOALS', 'OVERLOAD']) {
      const r = widgetInputSchema.safeParse(widget({ type, config: { rác: 1 } }));
      expect(r.success && r.data.config).toEqual({});
    }
  });

  it('tiêu đề ≤80, bắt buộc', () => {
    expect(widgetInputSchema.safeParse(widget({ title: 'x'.repeat(81) })).success).toBe(false);
    expect(widgetInputSchema.safeParse(widget({ title: ' ' })).success).toBe(false);
  });
});
