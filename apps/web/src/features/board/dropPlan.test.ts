import { describe, expect, it } from 'vitest';
import { planDrop } from './dropPlan';

describe('planDrop', () => {
  it('cùng cột: không đổi thứ tự => ignore; có đổi => reorder', () => {
    expect(planDrop({ resKind: 'stay', assigneeChanged: false, unchanged: true })).toBe('ignore');
    expect(planDrop({ resKind: 'stay', assigneeChanged: false, unchanged: false })).toBe('reorder');
  });
  it('sang cột khác (có/không có đường chuyển) => status (bị chặn thì BoardPage báo lỗi như cũ)', () => {
    expect(planDrop({ resKind: 'move', assigneeChanged: false, unchanged: false })).toBe('status');
    expect(planDrop({ resKind: 'blocked', assigneeChanged: false, unchanged: false })).toBe(
      'status',
    );
  });
  it('đổi người (hàng khác của swimlane theo người) luôn đi đường cũ', () => {
    for (const resKind of ['stay', 'move', 'blocked'] as const)
      expect(planDrop({ resKind, assigneeChanged: true, unchanged: false })).toBe('assign');
  });
});
