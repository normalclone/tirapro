import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeGuard,
  dirtyGuardEntries,
  pickBlockingEntries,
  useLeaveGuardStore,
  type GuardEntry,
} from './leaveGuard';

const entry = (dirty: boolean, over: Partial<GuardEntry> = {}): GuardEntry => ({
  isDirty: () => dirty,
  shouldBlock: () => true,
  description: () => 'mô tả',
  onDiscard: () => {},
  ...over,
});

const nav = (from: string, to: string) =>
  ({
    currentLocation: { pathname: from, search: '', hash: '', state: null, key: 'a' },
    nextLocation: { pathname: to, search: '', hash: '', state: null, key: 'b' },
    historyAction: 'PUSH',
  }) as Parameters<typeof pickBlockingEntries>[1];

describe('pickBlockingEntries', () => {
  it('không có mục nào → rỗng', () => {
    expect(pickBlockingEntries({}, nav('/a', '/b'))).toEqual([]);
  });

  it('hai form, chỉ form đầu dirty → chỉ mục đầu chặn (ca /account: hồ sơ dirty, mật khẩu trống)', () => {
    const r = pickBlockingEntries({ profile: entry(true), pw: entry(false) }, nav('/a', '/b'));
    expect(r.map(([id]) => id)).toEqual(['profile']);
  });

  it('shouldBlock loại điều hướng cùng đường dẫn', () => {
    const samePathOnly = entry(true, {
      shouldBlock: ({ currentLocation: a, nextLocation: b }) => a.pathname !== b.pathname,
    });
    expect(pickBlockingEntries({ x: samePathOnly }, nav('/a', '/a'))).toEqual([]);
    expect(pickBlockingEntries({ x: samePathOnly }, nav('/a', '/b'))).toHaveLength(1);
  });

  it('mục sạch không chặn dù shouldBlock trả true', () => {
    expect(pickBlockingEntries({ x: entry(false) }, nav('/a', '/b'))).toEqual([]);
  });

  it('mục dirty nhưng shouldBlock=false thì bỏ qua, mục khác vẫn chặn', () => {
    const r = pickBlockingEntries(
      { a: entry(true, { shouldBlock: () => false }), b: entry(true) },
      nav('/a', '/b'),
    );
    expect(r.map(([id]) => id)).toEqual(['b']);
  });
});

describe('dirtyGuardEntries / describeGuard', () => {
  it('đọc dirty MỚI NHẤT mỗi lần gọi', () => {
    let d = false;
    const e = entry(false, { isDirty: () => d });
    expect(dirtyGuardEntries({ e })).toEqual([]);
    d = true;
    expect(dirtyGuardEntries({ e })).toHaveLength(1);
  });

  it('một mục → mô tả của nó; nhiều mục → câu chung; không mục → rỗng', () => {
    const one = pickBlockingEntries(
      { a: entry(true, { description: () => 'A' }) },
      nav('/a', '/b'),
    );
    expect(describeGuard(one)).toBe('A');
    const two = pickBlockingEntries({ a: entry(true), b: entry(true) }, nav('/a', '/b'));
    expect(describeGuard(two)).toMatch(/nhiều chỗ/);
    expect(describeGuard([])).toBe('');
  });
});

describe('leave guard store', () => {
  beforeEach(() => useLeaveGuardStore.setState({ entries: {}, suspended: false }));

  it('set/remove không rò mục khi unmount; remove id lạ không đổi state', () => {
    const s = useLeaveGuardStore.getState();
    s.set('x', entry(true));
    s.remove('x');
    expect(useLeaveGuardStore.getState().entries.x).toBeUndefined();
    const before = useLeaveGuardStore.getState().entries;
    s.remove('nope');
    expect(useLeaveGuardStore.getState().entries).toBe(before);
  });

  it('onDiscard của từng mục dirty gọi được qua store', () => {
    const fn = vi.fn();
    useLeaveGuardStore.getState().set('w', entry(true, { onDiscard: fn }));
    for (const [, e] of dirtyGuardEntries(useLeaveGuardStore.getState().entries)) e.onDiscard();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
