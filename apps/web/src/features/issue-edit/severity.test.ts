import { describe, expect, it } from 'vitest';
import { isBugType } from './severity';

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
