import { describe, expect, it } from 'vitest';
import { createIssueSchema, updateIssueSchema } from './issue';

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
