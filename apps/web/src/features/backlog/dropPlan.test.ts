import { describe, expect, it } from 'vitest';
import type { Placement } from '@/lib/rankDrop';
import { neighborsIn, planBacklogDrop, widenNeighbors } from './dropPlan';

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

describe('widenNeighbors — mốc theo danh sách CHƯA lọc của khu đích', () => {
  // full (đã sắp rank, chưa lọc): a h1 b h2 h3 c  — h* là việc bị ẩn bởi bộ lọc
  const full = ['a', 'h1', 'b', 'h2', 'h3', 'c'];
  it('hai mốc đã có thì giữ nguyên', () => {
    expect(widenNeighbors(full, { afterId: 'a', beforeId: 'b' }, 'x')).toEqual({
      afterId: 'a',
      beforeId: 'b',
    });
  });
  it('thả lên đầu danh sách lọc (afterId null, beforeId b) => afterId = phần tử ngay trước b', () => {
    expect(widenNeighbors(full, { afterId: null, beforeId: 'b' }, 'x')).toEqual({
      afterId: 'h1',
      beforeId: 'b',
    });
  });
  it('thả xuống cuối danh sách lọc (afterId b, beforeId null) => beforeId = phần tử ngay sau b', () => {
    expect(widenNeighbors(full, { afterId: 'b', beforeId: null }, 'x')).toEqual({
      afterId: 'b',
      beforeId: 'h2',
    });
  });
  it('mốc đã là đầu/cuối khu chưa lọc thì không đổi', () => {
    expect(widenNeighbors(full, { afterId: null, beforeId: 'a' }, 'x')).toEqual({
      afterId: null,
      beforeId: 'a',
    });
    expect(widenNeighbors(full, { afterId: 'c', beforeId: null }, 'x')).toEqual({
      afterId: 'c',
      beforeId: null,
    });
  });
  it('khu đích lọc rỗng nhưng chưa lọc không rỗng => cuối khu', () => {
    expect(widenNeighbors(full, { afterId: null, beforeId: null }, 'x')).toEqual({
      afterId: 'c',
      beforeId: null,
    });
  });
  it('khu đích thật sự rỗng => hai mốc null (giữ rank, chỉ đổi sprint)', () => {
    expect(widenNeighbors([], { afterId: null, beforeId: null }, 'x')).toEqual({
      afterId: null,
      beforeId: null,
    });
  });
  it('bỏ chính dòng đang kéo khỏi danh sách (cùng khu)', () => {
    const f = ['a', 'x', 'b'];
    expect(widenNeighbors(f, { afterId: null, beforeId: 'b' }, 'x')).toEqual({
      afterId: 'a',
      beforeId: 'b',
    });
    expect(widenNeighbors(['x'], { afterId: null, beforeId: null }, 'x')).toEqual({
      afterId: null,
      beforeId: null,
    });
  });
  it('mốc không có trong danh sách (đã đổi/mất) thì giữ nguyên để server báo mốc cũ', () => {
    expect(widenNeighbors(full, { afterId: null, beforeId: 'zzz' }, 'x')).toEqual({
      afterId: null,
      beforeId: 'zzz',
    });
  });
});

describe('neighborsIn — chỗ cũ trong danh sách chưa lọc (Hoàn tác)', () => {
  it('láng giềng thật, kể cả việc bị ẩn', () => {
    expect(neighborsIn(['a', 'h1', 'x', 'h2', 'b'], 'x')).toEqual({
      afterId: 'h1',
      beforeId: 'h2',
    });
    expect(neighborsIn(['x', 'a'], 'x')).toEqual({ afterId: null, beforeId: 'a' });
    expect(neighborsIn(['a', 'x'], 'x')).toEqual({ afterId: 'a', beforeId: null });
    expect(neighborsIn(['a'], 'x')).toEqual({ afterId: null, beforeId: null });
  });
});
