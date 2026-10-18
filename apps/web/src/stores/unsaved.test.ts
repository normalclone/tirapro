import { beforeEach, describe, expect, it } from 'vitest';
import { dirtyEntries, summarizeDirty, useUnsavedStore, type UnsavedEntry } from './unsaved';

const entry = (dirty: boolean, over: Partial<UnsavedEntry> = {}): UnsavedEntry => ({
  dirty,
  saving: false,
  canSave: true,
  save: () => {},
  reset: () => {},
  ...over,
});

describe('unsaved store', () => {
  beforeEach(() => useUnsavedStore.setState({ entries: {} }));

  it('dirtyEntries chỉ trả mục đang dirty', () => {
    expect(dirtyEntries({ a: entry(true), b: entry(false) }).map(([id]) => id)).toEqual(['a']);
  });

  it('remove xoá hẳn mục (không rò khi form unmount)', () => {
    const s = useUnsavedStore.getState();
    s.set('x', entry(true));
    s.remove('x');
    expect(useUnsavedStore.getState().entries.x).toBeUndefined();
  });

  it('set ghi đè mục cùng id, không đụng mục khác', () => {
    const s = useUnsavedStore.getState();
    s.set('a', entry(false));
    s.set('b', entry(true));
    s.set('a', entry(true));
    const { entries } = useUnsavedStore.getState();
    expect(entries.a?.dirty).toBe(true);
    expect(Object.keys(entries).sort()).toEqual(['a', 'b']);
  });

  it('remove id không tồn tại thì không đổi state', () => {
    const before = useUnsavedStore.getState().entries;
    useUnsavedStore.getState().remove('nope');
    expect(useUnsavedStore.getState().entries).toBe(before);
  });
});

describe('summarizeDirty', () => {
  it('không có mục dirty → count 0', () => {
    expect(summarizeDirty({ a: entry(false) }).count).toBe(0);
    expect(summarizeDirty({}).count).toBe(0);
  });

  it('canSave = VÀ của mọi mục dirty (mục sạch không tính)', () => {
    expect(summarizeDirty({ a: entry(true), b: entry(true) }).canSave).toBe(true);
    expect(summarizeDirty({ a: entry(true), b: entry(true, { canSave: false }) }).canSave).toBe(
      false,
    );
    expect(summarizeDirty({ a: entry(true), b: entry(false, { canSave: false }) }).canSave).toBe(
      true,
    );
  });

  it('saving = HOẶC của mọi mục dirty', () => {
    expect(summarizeDirty({ a: entry(true), b: entry(true, { saving: true }) }).saving).toBe(true);
    expect(summarizeDirty({ a: entry(true), b: entry(false, { saving: true }) }).saving).toBe(
      false,
    );
  });
});
