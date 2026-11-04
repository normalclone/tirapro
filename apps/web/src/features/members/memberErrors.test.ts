import { describe, expect, it } from 'vitest';
import { memberErrorText } from './memberErrors';

describe('memberErrorText', () => {
  it('ALREADY_MEMBER nêu tên người (hoặc "Người này")', () => {
    expect(memberErrorText('ALREADY_MEMBER', 'Bình')).toBe('Bình đã là thành viên.');
    expect(memberErrorText('ALREADY_MEMBER')).toBe('Người này đã là thành viên.');
  });
  it('LAST_ORGANIZATION_ADMIN nói rõ không thể hạ/gỡ quản trị viên cuối cùng', () => {
    expect(memberErrorText('LAST_ORGANIZATION_ADMIN')).toContain('quản trị viên cuối cùng');
  });
  it('mã khác → undefined', () => expect(memberErrorText('NOT_FOUND')).toBeUndefined());
});
