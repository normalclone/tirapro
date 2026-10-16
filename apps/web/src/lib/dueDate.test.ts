import { afterEach, describe, expect, it, vi } from 'vitest';
import { dueDaysFromToday, dueState, isOverdue } from './dueDate';

const issue = (dueDate: string | null, category = 'IN_PROGRESS') => ({
  dueDate,
  status: { category },
});
// 09:00 giờ VN ngày 16/10/2026 = 02:00Z
const NOW = new Date('2026-10-16T02:00:00Z');
// 23:30 giờ VN ngày 16/10 = 16:30Z — ở UTC vẫn là 16/10, ở máy tây UTC cũng vậy; 00:30 VN 17/10 = 17:30Z 16/10
const LATE = new Date('2026-10-16T17:30:00Z'); // đã là 17/10 theo VN

describe('isOverdue / dueState theo ngày Việt Nam', () => {
  it('hạn hôm nay: chưa quá hạn; hôm qua: quá hạn', () => {
    expect(isOverdue(issue('2026-10-16T00:00:00.000Z'), NOW)).toBe(false);
    expect(isOverdue(issue('2026-10-15T00:00:00.000Z'), NOW)).toBe(true);
    expect(isOverdue(issue('2026-10-17T00:00:00.000Z'), NOW)).toBe(false);
  });
  it('"hôm nay" tính theo VN: 00:30 sáng 17/10 VN (còn 16/10 UTC) thì hạn 16/10 đã quá hạn', () => {
    expect(isOverdue(issue('2026-10-16T00:00:00.000Z'), LATE)).toBe(true);
    expect(isOverdue(issue('2026-10-17T00:00:00.000Z'), LATE)).toBe(false);
  });
  it('việc Done / không hạn / hạn rác không bao giờ quá hạn', () => {
    expect(isOverdue(issue('2026-10-01T00:00:00.000Z', 'DONE'), NOW)).toBe(false);
    expect(isOverdue(issue(null), NOW)).toBe(false);
    expect(isOverdue(issue('không phải ngày'), NOW)).toBe(false);
  });
  it('dueState: quá hạn / sắp (≤2 ngày) / bình thường / Done', () => {
    expect(dueState(issue('2026-10-15T00:00:00.000Z'), NOW)).toBe('overdue');
    expect(dueState(issue('2026-10-16T00:00:00.000Z'), NOW)).toBe('soon');
    expect(dueState(issue('2026-10-18T00:00:00.000Z'), NOW)).toBe('soon');
    expect(dueState(issue('2026-10-19T00:00:00.000Z'), NOW)).toBe('normal');
    expect(dueState(issue('2026-10-01T00:00:00.000Z', 'DONE'), NOW)).toBe('normal');
    expect(dueState(issue(null), NOW)).toBeNull();
  });
  it('số ngày lệch: -1 hôm qua, 0 hôm nay', () => {
    expect(dueDaysFromToday('2026-10-15T00:00:00.000Z', NOW)).toBe(-1);
    expect(dueDaysFromToday('2026-10-16T00:00:00.000Z', NOW)).toBe(0);
  });
});

describe('không phụ thuộc múi giờ của máy', () => {
  const orig = process.env.TZ;
  afterEach(() => {
    process.env.TZ = orig;
    vi.useRealTimers();
  });
  it.each(['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC'])('TZ=%s', (tz) => {
    process.env.TZ = tz;
    expect(isOverdue(issue('2026-10-16T00:00:00.000Z'), NOW)).toBe(false);
    expect(isOverdue(issue('2026-10-15T00:00:00.000Z'), NOW)).toBe(true);
    expect(isOverdue(issue('2026-10-16T00:00:00.000Z'), LATE)).toBe(true);
  });
});
