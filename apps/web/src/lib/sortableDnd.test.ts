import { describe, expect, it } from 'vitest';
import type { CollisionDetection } from '@dnd-kit/core';
import { sortableCollision } from './sortableDnd';

type Args = Parameters<CollisionDetection>[0];
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const container = (id: string, data: unknown) => ({
  id,
  data: { current: data },
  disabled: false,
  node: { current: null },
  rect: { current: null },
});

// Cột 'col' (0..200 × 0..300) có hai thẻ a (10..190 × 10..90) và b (10..190 × 110..190); khe giữa thẻ y 90..110.
const containers = [
  container('col', { container: { items: ['a', 'b'] } }),
  container('a', { sortable: { containerId: 'col' } }),
  container('b', { sortable: { containerId: 'col' } }),
];
const droppableRects = new Map([
  ['col', rect(0, 0, 200, 300)],
  ['a', rect(10, 10, 180, 80)],
  ['b', rect(10, 110, 180, 80)],
]);
const run = (pointer: { x: number; y: number } | null) =>
  sortableCollision({
    active: { id: 'z' },
    collisionRect: rect(10, 200, 180, 80),
    droppableRects,
    droppableContainers: containers,
    pointerCoordinates: pointer,
  } as unknown as Args).map((c) => c.id);

describe('sortableCollision', () => {
  it('con trỏ trên thẻ => thẻ đó đứng đầu', () => {
    expect(run({ x: 100, y: 50 })[0]).toBe('a');
  });
  it('con trỏ ở khe giữa hai thẻ (trong cột) => thẻ gần nhất, không phải cột', () => {
    expect(['a', 'b']).toContain(run({ x: 100, y: 100 })[0]);
  });
  it('kéo chuột, con trỏ ngoài mọi cột (toolbar, lề, khe giữa cột) => không có đích', () => {
    expect(run({ x: 500, y: 50 })).toEqual([]);
    expect(run({ x: 100, y: -40 })).toEqual([]);
  });
  it('bàn phím (không có toạ độ con trỏ) => closestCorners, luôn có đích', () => {
    expect(run(null).length).toBeGreaterThan(0);
  });
});
