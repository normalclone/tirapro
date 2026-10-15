import { describe, expect, it } from 'vitest';
import { BLANK, UNMAPPED, autoMapUsers, buildUserMapping } from './jiraUsers';

const members = [
  { id: 'u1', displayName: 'Nguyễn An', email: 'an@x.com' },
  { id: 'u2', displayName: 'Bình', email: 'b@x.com' },
];

describe('autoMapUsers', () => {
  it('khớp email rồi tên; người không khớp BỊ BỎ KHOÁ (chưa ghép), không phải "Để trống"', () => {
    const m = autoMapUsers(
      [{ name: 'an@x.com', email: 'an@x.com' }, { name: 'bình' }, { name: 'Cường' }],
      members,
    );
    expect(m).toEqual({ 'an@x.com': 'u1', bình: 'u2' });
    expect('Cường' in m).toBe(false);
  });
});

describe('buildUserMapping — chưa ghép ≠ chủ động để trống', () => {
  it('UNMAPPED → bỏ khoá; BLANK → null; id → giữ nguyên', () => {
    expect(buildUserMapping({ A: 'u1', B: BLANK, C: UNMAPPED })).toEqual({ A: 'u1', B: null });
  });
  it('người chưa đụng tới (không có khoá) không xuất hiện trong mapping gửi API', () => {
    expect(buildUserMapping(autoMapUsers([{ name: 'Cường' }], members))).toEqual({});
  });
});
