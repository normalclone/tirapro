import { describe, expect, it } from 'vitest';
import { canRetract, retractMinutesLeft } from './retract';

const now = new Date('2026-10-16T10:10:00Z');
describe('retractMinutesLeft', () => {
  it('làm tròn lên, 0 khi quá hạn', () => {
    expect(retractMinutesLeft('2026-10-16T10:08:30Z', now)).toBe(9);
    expect(retractMinutesLeft('2026-10-16T09:59:00Z', now)).toBe(0);
  });
  it('vừa tạo => đủ 10 phút; ngày giờ sai => 0', () => {
    expect(retractMinutesLeft('2026-10-16T10:10:00Z', now)).toBe(10);
    expect(retractMinutesLeft('không-phải-ngày', now)).toBe(0);
  });
});
describe('canRetract', () => {
  const issue = { reporterId: 'u1', createdById: 'u1', createdAt: '2026-10-16T10:08:00Z' };
  it('người báo + trong hạn + chưa có quyền xoá chung', () => {
    expect(canRetract(issue, 'u1', () => false, now)).toBe(true);
    expect(canRetract(issue, 'u2', () => false, now)).toBe(false);
    expect(canRetract(issue, 'u1', (p) => p === 'issue:delete', now)).toBe(false); // đã có menu Xoá
    expect(
      canRetract({ ...issue, createdAt: '2026-10-16T09:00:00Z' }, 'u1', () => false, now),
    ).toBe(false);
  });
  it('người tạo (không phải người báo) cũng được; assignee thì không; chưa đăng nhập thì không', () => {
    expect(canRetract({ ...issue, reporterId: 'u2' }, 'u1', () => false, now)).toBe(true);
    expect(
      canRetract({ ...issue, reporterId: 'u2', createdById: 'u2' }, 'u1', () => false, now),
    ).toBe(false);
    expect(canRetract(issue, undefined, () => false, now)).toBe(false);
  });
});
