import { describe, expect, it } from 'vitest';
import { mk } from '@/lib/issueFixture';
import { planTreeDrop } from './treeDrop';

const e = mk('e', { t: 'epic' }),
  e2 = mk('e2', { t: 'epic' });
const s = mk('s'),
  c = mk('c', { parentId: 's' }),
  g = mk('g', { parentId: 'c' }),
  sub = mk('u', { t: 'sub', parentId: 's' });
const inE = mk('i', { epicId: 'e' });
const all = [e, e2, s, c, g, sub, inE];

describe('planTreeDrop', () => {
  it('thả lên Epic: gắn epicId và xoá parentId (để cây thấy dưới epic)', () =>
    expect(planTreeDrop(c, e, all)).toEqual({
      kind: 'set',
      patch: { epicId: 'e', parentId: null },
      restore: { parentId: 's', epicId: null },
    }));
  it('thả lên việc thường: đặt việc cha', () =>
    expect(planTreeDrop(inE, s, all)).toEqual({
      kind: 'set',
      patch: { parentId: 's' },
      restore: { parentId: null, epicId: 'e' },
    }));
  it('sub-task thả lên Epic: đặt làm việc con trực tiếp (parentId), không phải epicId', () =>
    expect(planTreeDrop(sub, e, all)).toMatchObject({ kind: 'set', patch: { parentId: 'e' } }));
  it('đã đúng chỗ => bỏ qua', () => {
    expect(planTreeDrop(c, s, all)).toEqual({ kind: 'ignore' });
    expect(planTreeDrop(inE, e, all)).toEqual({ kind: 'ignore' });
  });
  it('vòng: thả lên chính nó hoặc con cháu => reject', () => {
    expect(planTreeDrop(s, s, all)).toMatchObject({ kind: 'reject' });
    expect(planTreeDrop(s, g, all)).toMatchObject({ kind: 'reject' });
  });
  it('Epic chỉ được đưa ra ngoài, không vào việc/epic khác', () => {
    expect(planTreeDrop(e, s, all)).toMatchObject({ kind: 'reject' });
    expect(planTreeDrop(e, e2, all)).toMatchObject({ kind: 'reject' });
    expect(planTreeDrop(e, null, all)).toEqual({ kind: 'ignore' }); // đã ở gốc
  });
  it('đưa ra ngoài: xoá cả parentId lẫn epicId; đã ở gốc thì bỏ qua', () => {
    expect(planTreeDrop(g, null, all)).toEqual({
      kind: 'set',
      patch: { parentId: null, epicId: null },
      restore: { parentId: 'c', epicId: null },
    });
    expect(planTreeDrop(mk('lone'), null, all)).toEqual({ kind: 'ignore' });
  });
  it('việc con (sub-task) không chứa việc khác => reject', () =>
    expect(planTreeDrop(inE, sub, all)).toMatchObject({ kind: 'reject' }));
});
