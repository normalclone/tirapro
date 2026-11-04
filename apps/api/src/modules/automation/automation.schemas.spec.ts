import { describe, expect, it } from 'vitest';
import { issuePayloadSchema } from './automation.schemas';

describe('issuePayloadSchema — mẫu / việc lặp lại mang độ khó, không mang điểm', () => {
  it('nhận difficulty hợp lệ, từ chối mức lạ', () => {
    expect(issuePayloadSchema.safeParse({ difficulty: 'HARD' }).success).toBe(true);
    expect(issuePayloadSchema.safeParse({ difficulty: 'HARD' }).data).toEqual({
      difficulty: 'HARD',
    });
    expect(issuePayloadSchema.safeParse({ difficulty: 'Khó' }).success).toBe(false);
  });
  it('payload cũ có storyPoints vẫn đọc được nhưng điểm bị bỏ (điểm tự tính theo công thức)', () => {
    const r = issuePayloadSchema.safeParse({ summary: 'x', storyPoints: 8 });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ summary: 'x' });
  });
});
