import { describe, expect, it } from 'vitest';
import { unmatchedAssigneesNotice } from './jiraSummary';

describe('unmatchedAssigneesNotice', () => {
  it('không có việc bị bỏ gán (hoặc API cũ chưa có trường) → null', () => {
    expect(unmatchedAssigneesNotice({})).toBeNull();
    expect(unmatchedAssigneesNotice({ skippedAssignees: 0 })).toBeNull();
  });
  it('nêu số việc và danh sách tên/email không khớp', () => {
    const t = unmatchedAssigneesNotice({
      skippedAssignees: 5,
      unmatchedAssignees: [
        { name: 'Lê Minh Cường', count: 4 },
        { name: 'x@y.com', count: 1 },
      ],
      unmatchedAssigneesMore: 0,
    });
    expect(t).toContain('5 việc');
    expect(t).toContain('Lê Minh Cường, x@y.com');
    expect(t).not.toContain('người khác');
  });
  it('vượt giới hạn liệt kê → "và N người khác"', () => {
    const t = unmatchedAssigneesNotice({
      skippedAssignees: 30,
      unmatchedAssignees: [{ name: 'A', count: 10 }],
      unmatchedAssigneesMore: 7,
    });
    expect(t).toContain(': A và 7 người khác');
  });
  it('có số nhưng thiếu danh sách (API khác) vẫn báo số việc', () => {
    expect(unmatchedAssigneesNotice({ skippedAssignees: 2 })).toMatch(/^2 việc/);
  });
});
