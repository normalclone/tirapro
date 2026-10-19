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

describe('unmatchedAssigneesNotice — email đã nhớ (L28)', () => {
  it('chỉ có người đã nhớ email: câu "sẽ tự gán khi <email> được thêm vào không gian làm việc", không còn lời cảnh báo mất người', () => {
    const t = unmatchedAssigneesNotice({
      skippedAssignees: 4,
      rememberedAssignees: 4,
      rememberedEmails: ['cuong@x.com'],
      unmatchedAssignees: [],
    });
    expect(t).toBe(
      '4 việc chưa có người phụ trách — sẽ tự gán khi cuong@x.com được thêm vào không gian làm việc.',
    );
    expect(t).not.toContain('mời');
  });
  it('nhiều email + phần vượt giới hạn', () => {
    const t = unmatchedAssigneesNotice({
      skippedAssignees: 6,
      rememberedAssignees: 6,
      rememberedEmails: ['a@x.com', 'b@x.com'],
      rememberedEmailsMore: 3,
    });
    expect(t).toContain('a@x.com, b@x.com và 3 email khác');
  });
  it('lẫn hai nhóm: nhóm không có email vẫn nhận câu cũ (không chữ "mời"), tách khỏi nhóm đã nhớ', () => {
    const t = unmatchedAssigneesNotice({
      skippedAssignees: 7,
      rememberedAssignees: 4,
      rememberedEmails: ['cuong@x.com'],
      unmatchedAssignees: [{ name: 'Bình', count: 3 }],
      unmatchedAssigneesMore: 0,
    })!;
    expect(t).toContain('3 việc đã nhập nhưng chưa có người phụ trách');
    expect(t).toContain(': Bình');
    expect(t).toContain('Hãy thêm họ vào không gian làm việc rồi gán lại.');
    expect(t).toContain('4 việc chưa có người phụ trách — sẽ tự gán khi cuong@x.com');
    expect(t).not.toContain('mời');
  });
});
