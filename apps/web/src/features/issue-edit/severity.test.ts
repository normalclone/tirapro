import { describe, expect, it } from 'vitest';
import { defaultSeverityId, isBugType } from './severity';

describe('isBugType', () => {
  it('khoá BUG hoặc tên chứa bug/lỗi', () => {
    expect(isBugType({ key: 'BUG', name: 'Whatever' })).toBe(true);
    expect(isBugType({ key: null, name: 'Production Bug' })).toBe(true);
    expect(isBugType({ key: null, name: 'Lỗi' })).toBe(true);
    expect(isBugType({ key: 'STORY', name: 'Story' })).toBe(false);
    expect(isBugType({ key: null, name: 'Debugging' })).toBe(false);
    expect(isBugType(undefined)).toBe(false);
  });
});

describe('defaultSeverityId', () => {
  it('lấy mức isDefault; không có thì mức rank cao nhất; rỗng => null', () => {
    const l = [
      { id: 'a', rank: 4, isDefault: false },
      { id: 'b', rank: 3, isDefault: true },
    ];
    expect(defaultSeverityId(l)).toBe('b');
    expect(
      defaultSeverityId([
        { id: 'a', rank: 4, isDefault: false },
        { id: 'c', rank: 2, isDefault: false },
      ]),
    ).toBe('a');
    expect(defaultSeverityId([])).toBeNull();
  });
});
