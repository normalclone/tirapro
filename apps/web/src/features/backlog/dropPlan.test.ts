import { describe, expect, it } from 'vitest';
import type { Placement } from '@/lib/rankDrop';
import { planBacklogDrop } from './dropPlan';

const p = (over: Partial<Placement>): Placement => ({
  containerId: 'backlog',
  index: 0,
  total: 1,
  afterId: null,
  beforeId: null,
  origin: { afterId: null, beforeId: null },
  crossContainer: false,
  unchanged: false,
  ...over,
});

describe('planBacklogDrop', () => {
  it('cùng khu, thứ tự không đổi => bỏ qua', () => {
    expect(planBacklogDrop({ sprintId: null }, p({ unchanged: true }), 'backlog')).toEqual({
      ignore: true,
    });
    expect(
      planBacklogDrop({ sprintId: 's1' }, p({ containerId: 's1', unchanged: true }), 'backlog'),
    ).toEqual({ ignore: true });
  });
  it('cùng khu, đổi chỗ => không đổi sprint', () => {
    expect(planBacklogDrop({ sprintId: 's1' }, p({ containerId: 's1' }), 'backlog')).toEqual({
      ignore: false,
      targetSprintId: 's1',
      sprintChanged: false,
    });
  });
  it('backlog → sprint và sprint → backlog (id "backlog" = sprintId null)', () => {
    expect(
      planBacklogDrop(
        { sprintId: null },
        p({ containerId: 's2', crossContainer: true }),
        'backlog',
      ),
    ).toEqual({ ignore: false, targetSprintId: 's2', sprintChanged: true });
    expect(
      planBacklogDrop(
        { sprintId: 's2' },
        p({ containerId: 'backlog', crossContainer: true }),
        'backlog',
      ),
    ).toEqual({ ignore: false, targetSprintId: null, sprintChanged: true });
  });
  it('sang khu khác dù khu đích không đổi thứ tự vẫn là chuyển sprint (unchanged chỉ đúng khi cùng container)', () => {
    expect(
      planBacklogDrop(
        { sprintId: null },
        p({ containerId: 's2', crossContainer: true, unchanged: false }),
        'backlog',
      ).ignore,
    ).toBe(false);
  });
});
