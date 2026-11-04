import { describe, expect, it } from 'vitest';
import { bulkUpdateIssuesSchema, createIssueSchema, updateIssueSchema } from './issue';

const base = { projectId: 'p', typeId: 't', summary: 'ok' };

describe('createIssueSchema (logbug)', () => {
  it('điểm ước lượng tối đa 100 (#11)', () => {
    expect(createIssueSchema.safeParse({ ...base, storyPoints: 100 }).success).toBe(true);
    const r = createIssueSchema.safeParse({ ...base, storyPoints: 101 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe('Điểm tối đa 100');
    expect(updateIssueSchema.safeParse({ version: 1, storyPoints: 500 }).success).toBe(false);
  });
  it('tiêu đề > 255 ký tự báo rõ giới hạn (#13)', () => {
    const r = createIssueSchema.safeParse({ ...base, summary: 'x'.repeat(256) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toContain('255');
  });
});

describe('issue schemas — độ khó và điểm ghi đè', () => {
  it('difficulty: bốn mức ở create/update/bulk; mức lạ bị từ chối', () => {
    expect(createIssueSchema.safeParse({ ...base, difficulty: 'VERY_HARD' }).success).toBe(true);
    expect(createIssueSchema.safeParse({ ...base, difficulty: 'IMPOSSIBLE' }).success).toBe(false);
    expect(updateIssueSchema.safeParse({ version: 1, difficulty: 'HARD' }).success).toBe(true);
    expect(
      bulkUpdateIssuesSchema.safeParse({
        projectId: 'p',
        items: [{ id: 'a', version: 1 }],
        patch: { difficulty: 'EASY' },
      }).success,
    ).toBe(true);
  });
  it('điểm ghi đè ở update/bulk phải là số nguyên 0–100', () => {
    expect(updateIssueSchema.safeParse({ version: 1, storyPoints: 7 }).success).toBe(true);
    expect(updateIssueSchema.safeParse({ version: 1, storyPoints: 2.5 }).success).toBe(false);
    const bulk = (storyPoints: number) =>
      bulkUpdateIssuesSchema.safeParse({
        projectId: 'p',
        items: [{ id: 'a', version: 1 }],
        patch: { storyPoints },
      }).success;
    expect(bulk(0)).toBe(true);
    expect(bulk(100)).toBe(true);
    expect(bulk(1.5)).toBe(false);
    expect(bulk(101)).toBe(false);
  });
});
