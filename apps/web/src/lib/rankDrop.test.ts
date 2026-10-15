import { describe, expect, it } from 'vitest';
import { computePlacement, placementFromDnd } from './rankDrop';

const base = { activeId: 'b', fromContainer: 'c1', fromItems: ['a', 'b', 'c', 'd'] };

describe('computePlacement — cùng container (nghĩa arrayMove của dnd-kit)', () => {
  it('kéo xuống thả lên thẻ d => đứng SAU d (cuối)', () => {
    const p = computePlacement({
      ...base,
      toContainer: 'c1',
      toItems: base.fromItems,
      overId: 'd',
      below: false,
    });
    expect(p).toMatchObject({
      index: 3,
      total: 4,
      afterId: 'd',
      beforeId: null,
      crossContainer: false,
      unchanged: false,
    });
  });
  it('kéo lên thả lên thẻ a => đứng TRƯỚC a', () => {
    const p = computePlacement({
      activeId: 'c',
      fromContainer: 'c1',
      fromItems: ['a', 'b', 'c'],
      toContainer: 'c1',
      toItems: ['a', 'b', 'c'],
      overId: 'a',
      below: false,
    });
    expect(p).toMatchObject({ index: 0, afterId: null, beforeId: 'a', unchanged: false });
  });
  it('thả lên chính mình hoặc về đúng chỗ cũ => unchanged', () => {
    expect(
      computePlacement({
        ...base,
        toContainer: 'c1',
        toItems: base.fromItems,
        overId: 'b',
        below: false,
      }).unchanged,
    ).toBe(true);
    expect(
      computePlacement({
        ...base,
        toContainer: 'c1',
        toItems: base.fromItems,
        overId: 'c',
        below: false,
      }),
    ).toMatchObject({ unchanged: false, afterId: 'c', beforeId: 'd' });
  });
  it('thả vào khoảng trống của chính container (over = container) => xuống cuối', () => {
    const p = computePlacement({
      ...base,
      toContainer: 'c1',
      toItems: base.fromItems,
      overId: 'c1',
      below: false,
    });
    expect(p).toMatchObject({ index: 3, afterId: 'd', beforeId: null });
  });
});

describe('computePlacement — sang container khác', () => {
  const x = { ...base, toContainer: 'c2', toItems: ['x', 'y'] };
  it('thả lên thẻ y, nửa trên => chèn TRƯỚC y; nửa dưới => SAU y', () => {
    expect(computePlacement({ ...x, overId: 'y', below: false })).toMatchObject({
      index: 1,
      total: 3,
      afterId: 'x',
      beforeId: 'y',
      crossContainer: true,
      unchanged: false,
    });
    expect(computePlacement({ ...x, overId: 'y', below: true })).toMatchObject({
      index: 2,
      afterId: 'y',
      beforeId: null,
    });
  });
  it('thả vào container trống / khoảng trống => hai mốc null; origin là láng giềng ở vị trí cũ', () => {
    const p = computePlacement({ ...x, toItems: [], overId: 'c2', below: false });
    expect(p).toMatchObject({
      index: 0,
      total: 1,
      afterId: null,
      beforeId: null,
      origin: { afterId: 'a', beforeId: 'c' },
    });
  });
});

describe('placementFromDnd', () => {
  const sortable = (containerId: string, items: string[], index: number) => ({
    sortable: { containerId, items, index },
  });
  it('đọc dữ liệu sortable của active/over và hướng (nửa dưới của over)', () => {
    const p = placementFromDnd({
      active: {
        id: 'b',
        data: { current: sortable('c1', ['a', 'b', 'c'], 1) },
        rect: { current: { translated: { top: 100, height: 40 } } },
      },
      over: {
        id: 'y',
        data: { current: sortable('c2', ['x', 'y'], 1) },
        rect: { top: 90, height: 40 },
      },
    });
    expect(p).toMatchObject({
      containerId: 'c2',
      crossContainer: true,
      afterId: 'y',
      beforeId: null,
    });
  });
  it('over là container (data.container.items) => id container chính là over.id', () => {
    const p = placementFromDnd({
      active: {
        id: 'b',
        data: { current: sortable('c1', ['a', 'b'], 1) },
        rect: { current: { translated: null } },
      },
      over: {
        id: 'c2',
        data: { current: { container: { items: ['x'] } } },
        rect: { top: 0, height: 300 },
      },
    });
    expect(p).toMatchObject({ containerId: 'c2', afterId: 'x', beforeId: null });
  });
  it('không có over hoặc active không phải sortable => null', () => {
    expect(
      placementFromDnd({
        active: { id: 'b', data: { current: undefined }, rect: { current: { translated: null } } },
        over: null,
      }),
    ).toBeNull();
  });
});
