import { describe, expect, it, vi } from 'vitest';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { CollisionDetection } from '@dnd-kit/core';
import { epicDropId } from './epic';
import {
  epicAwareCollision,
  epicAwareKeyboardCoordinates,
  overlapsEpicPanel,
  sortableCollision,
} from './sortableDnd';

vi.mock('@dnd-kit/sortable', () => ({ sortableKeyboardCoordinates: vi.fn(() => undefined) }));
const inner = vi.mocked(sortableKeyboardCoordinates);

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

// Panel Epic bên trái (0..100) và danh sách bên phải (120..320): hàng 'r1' ngay sát panel về chiều dọc.
const epicContainers = [
  container(epicDropId('e1'), undefined),
  container('r1', { sortable: { containerId: 'sec' } }),
  container('r2', { sortable: { containerId: 'sec' } }),
];
const epicRects = new Map([
  [epicDropId('e1'), rect(0, 0, 100, 60)],
  ['r1', rect(120, 20, 200, 40)],
  ['r2', rect(120, 70, 200, 40)],
]);

describe('overlapsEpicPanel', () => {
  it('chỉ khi cạnh trái vùng kéo lọt vào bề ngang panel', () => {
    expect(overlapsEpicPanel({ left: 130 }, [{ right: 100 }])).toBe(false);
    expect(overlapsEpicPanel({ left: 20 }, [{ right: 100 }])).toBe(true);
    expect(overlapsEpicPanel(null, [{ right: 100 }])).toBe(false);
    expect(overlapsEpicPanel({ left: 20 }, [])).toBe(false);
  });
});

describe('epicAwareCollision (bàn phím không rơi nhầm vào mục epic)', () => {
  const run = (left: number, pointer: { x: number; y: number } | null = null) =>
    epicAwareCollision({
      active: { id: 'r2' },
      collisionRect: rect(left, 10, 200, 40),
      droppableRects: epicRects,
      droppableContainers: epicContainers,
      pointerCoordinates: pointer,
    } as unknown as Args).map((c) => String(c.id));
  it('vùng kéo ở cột danh sách => không có mục epic trong kết quả', () => {
    expect(run(125)).not.toContain(epicDropId('e1'));
  });
  it('vùng kéo đã sang panel => mục epic được xét', () => {
    expect(run(10)[0]).toBe(epicDropId('e1'));
  });
  it('kéo chuột: giữ nguyên hành vi (con trỏ trên mục epic => mục epic)', () => {
    expect(run(125, { x: 50, y: 30 })[0]).toBe(epicDropId('e1'));
  });
});

describe('epicAwareKeyboardCoordinates', () => {
  const ctx = (left: number) => ({
    active: { id: 'r2' },
    collisionRect: rect(left, 70, 200, 40),
    droppableRects: epicRects,
    droppableContainers: {
      getEnabled: () => epicContainers,
      get: (id: string) => epicContainers.find((c) => c.id === id),
    },
    over: null,
    scrollableAncestors: [],
  });
  /** Các ứng viên (id) mà hàm gốc của dnd-kit nhận được cho phím `code`. */
  const candidates = (code: string, left: number): string[] => {
    inner.mockClear();
    epicAwareKeyboardCoordinates(
      { code, preventDefault: () => undefined } as KeyboardEvent,
      {
        currentCoordinates: { x: left, y: 70 },
        context: ctx(left),
      } as unknown as Parameters<typeof epicAwareKeyboardCoordinates>[1],
    );
    const passed = inner.mock.calls[0]![1] as {
      context: { droppableContainers: { getEnabled: () => { id: string }[] } };
    };
    return passed.context.droppableContainers.getEnabled().map((c) => String(c.id));
  };

  it('ArrowUp/Down ở cột danh sách: mục epic không phải ứng viên', () => {
    expect(candidates('ArrowUp', 125)).not.toContain(epicDropId('e1'));
    expect(candidates('ArrowDown', 125)).not.toContain(epicDropId('e1'));
  });
  it('ArrowLeft: mục epic là ứng viên (chủ động sang panel)', () => {
    expect(candidates('ArrowLeft', 125)).toContain(epicDropId('e1'));
  });
  it('đang ở panel: mũi tên nào cũng xét mục epic', () => {
    expect(candidates('ArrowDown', 10)).toContain(epicDropId('e1'));
  });
});
