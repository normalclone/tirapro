import { describe, expect, it } from 'vitest';
import { scalarIssuePatch } from './optimistic';

describe('scalarIssuePatch — Tiêu chí chấp nhận', () => {
  it('vá luôn acceptanceProgress để thẻ đổi ngay khi tick', () => {
    expect(scalarIssuePatch({ acceptanceCriteria: '- [x] a\n- [ ] b', version: 1 })).toEqual({
      acceptanceCriteria: '- [x] a\n- [ ] b',
      acceptanceProgress: { done: 1, total: 2 },
    });
  });
  it('xoá hết tiêu chí → progress null; field khác không bị đụng', () => {
    expect(scalarIssuePatch({ acceptanceCriteria: null })).toEqual({
      acceptanceCriteria: null,
      acceptanceProgress: null,
    });
    expect(scalarIssuePatch({ summary: 'x' })).toEqual({ summary: 'x' });
  });
});
