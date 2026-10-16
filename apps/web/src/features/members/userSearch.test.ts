import { describe, expect, it } from 'vitest';
import { showTypeToSearchHint, userSearchQuery } from './userSearch';

describe('userSearchQuery (S-I7)', () => {
  it('mặc định chỉ có limit=50', () => expect(userSearchQuery({})).toBe('limit=50'));
  it('đủ tham số, search được cắt khoảng trắng', () => {
    expect(
      userSearchQuery({ projectId: 'p1', search: '  an ', limit: 200, includeInactive: true }),
    ).toBe('projectId=p1&search=an&limit=200&includeInactive=true');
  });
  it('limit kẹp 1..200; search trống bị bỏ', () => {
    expect(userSearchQuery({ limit: 999, search: '   ' })).toBe('limit=200');
    expect(userSearchQuery({ limit: 0 })).toBe('limit=1');
  });
  it('mã tiếng Việt/ký tự đặc biệt được mã hoá', () => {
    expect(userSearchQuery({ search: 'Đức & Bình' })).toContain(
      'search=%C4%90%E1%BB%A9c+%26+B%C3%ACnh',
    );
  });
});

describe('showTypeToSearchHint', () => {
  it('đầy 50 mà chưa gõ → nhắc gõ để tìm thêm', () => {
    expect(showTypeToSearchHint(50, '')).toBe(true);
    expect(showTypeToSearchHint(12, '')).toBe(false);
    expect(showTypeToSearchHint(50, 'an')).toBe(false);
  });
});
