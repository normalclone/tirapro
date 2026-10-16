import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  keyLabel,
  orderedGroups,
  scopeForPath,
  shortcutsOf,
  withKey,
} from './shortcuts';

describe('kho phím tắt', () => {
  it('id duy nhất; không có hai phím trùng trong cùng nhóm', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sig = SHORTCUTS.map((s) => `${s.scope}:${s.keys.join('+')}`);
    expect(new Set(sig).size).toBe(sig.length);
  });
  it('ba nhóm đúng tên', () => {
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual([
      'Trong công việc',
      'Trên board',
      'Toàn cục',
    ]);
  });
  it('mỗi nhóm có ít nhất một phím', () => {
    for (const g of SHORTCUT_GROUPS) expect(shortcutsOf(g.scope).length).toBeGreaterThan(0);
  });
  it('có đủ các phím dev hay dùng', () => {
    const keys = new Set(SHORTCUTS.flatMap((s) => s.keys));
    for (const k of ['i', 'y', 'w', 'm', 'c', '/', '?']) expect(keys.has(k)).toBe(true);
  });
  it('withKey ghép phím vào tooltip', () => {
    expect(withKey('Gán cho tôi', 'issue.assignMe')).toBe('Gán cho tôi · phím i');
    expect(withKey('Lệnh nhanh', 'global.palette')).toBe('Lệnh nhanh · phím ⌘ K');
  });
  it('id không tồn tại → trả nhãn gốc, không ném lỗi', () =>
    expect(withKey('X', 'nope')).toBe('X'));
  it('mục pending không hiện ở nhóm và không ghép vào tooltip', () => {
    const pending = SHORTCUTS.filter((s) => s.pending);
    for (const p of pending) {
      expect(shortcutsOf(p.scope).some((s) => s.id === p.id)).toBe(false);
      expect(withKey('X', p.id)).toBe('X');
      expect(keyLabel(p.id)).toBeUndefined();
    }
  });
  it('j k a e đã hiện ở bảng: j/k/a/e trên board, a/e trong công việc', () => {
    const board = shortcutsOf('board').flatMap((s) => s.keys);
    for (const k of ['j', 'k', 'a', 'e']) expect(board).toContain(k);
    const issue = shortcutsOf('issue').flatMap((s) => s.keys);
    for (const k of ['a', 'e']) expect(issue).toContain(k);
  });
  it('mọi id có tiền tố đúng nhóm', () => {
    for (const s of SHORTCUTS) expect(s.id.startsWith(`${s.scope}.`)).toBe(true);
  });
});

describe('nhóm theo màn hiện tại', () => {
  it('trang công việc / board / việc chờ nhận ra nhóm; trang khác thì không', () => {
    expect(scopeForPath('/issue/DEMO-1')).toBe('issue');
    expect(scopeForPath('/p/DEMO/board')).toBe('board');
    expect(scopeForPath('/p/DEMO/backlog')).toBe('board');
    expect(scopeForPath('/p/DEMO/reports')).toBeNull();
    expect(scopeForPath('/')).toBeNull();
  });
  it('nhóm khớp xếp lên đầu và đánh dấu current', () => {
    const g = orderedGroups('/p/DEMO/board');
    expect(g.map((x) => x.scope)).toEqual(['board', 'issue', 'global']);
    expect(g.map((x) => x.current)).toEqual([true, false, false]);
  });
  it('không khớp → giữ thứ tự gốc, không nhóm nào current', () => {
    const g = orderedGroups('/');
    expect(g.map((x) => x.scope)).toEqual(['issue', 'board', 'global']);
    expect(g.some((x) => x.current)).toBe(false);
  });
});
