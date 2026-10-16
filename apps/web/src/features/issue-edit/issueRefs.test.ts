import { describe, expect, it } from 'vitest';
import { splitIssueKeys } from './issueRefs';

describe('splitIssueKeys', () => {
  const known = new Set(['DEMO-STORY-3', 'DEMO-BUG-1']);
  it('tách văn bản thành đoạn chữ và mã đã biết; mã lạ giữ nguyên là chữ', () => {
    expect(splitIssueKeys('Xem DEMO-STORY-3, UTF-8 và DEMO-BUG-1.', known)).toEqual([
      { type: 'text', value: 'Xem ' },
      { type: 'key', value: 'DEMO-STORY-3' },
      { type: 'text', value: ', UTF-8 và ' },
      { type: 'key', value: 'DEMO-BUG-1' },
      { type: 'text', value: '.' },
    ]);
  });
  it('không có mã nào đã biết → một đoạn chữ duy nhất', () => {
    expect(splitIssueKeys('chỉ chữ DEMO-9', known)).toEqual([
      { type: 'text', value: 'chỉ chữ DEMO-9' },
    ]);
  });
  it('known rỗng → trả nguyên văn bản (đường nhanh)', () => {
    expect(splitIssueKeys('DEMO-STORY-3', new Set())).toEqual([
      { type: 'text', value: 'DEMO-STORY-3' },
    ]);
  });
});
