import { describe, expect, it } from 'vitest';
import { selects } from './where-matcher';

describe('where-matcher', () => {
  it('`OR: []` bị từ chối: Prisma thật xử lý nó không nhất quán (top-level = rỗng, trong AND = bị bỏ qua)', () => {
    expect(() => selects({ id: 'a' }, { OR: [] })).toThrow(/OR: \[\]/);
    expect(() => selects({ id: 'a' }, { AND: [{ OR: [] }] })).toThrow(/OR: \[\]/);
  });
  it('{ id: { in: [] } } = không khớp gì', () => {
    expect(selects({ id: 'a' }, { id: { in: [] } })).toBe(false);
    expect(selects({ id: 'a' }, { AND: [{ id: { in: [] } }] })).toBe(false);
  });
});
