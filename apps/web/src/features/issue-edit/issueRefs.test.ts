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
  it('mã Jira gốc có "_" được chip nguyên mã, không chip nhầm APP-12', () => {
    const k = new Set(['MY_APP-12', 'JRA-1', 'PROJ-STORY-1', 'APP-12']);
    expect(splitIssueKeys('Xem MY_APP-12, JRA-1 và PROJ-STORY-1', k)).toEqual([
      { type: 'text', value: 'Xem ' },
      { type: 'key', value: 'MY_APP-12' },
      { type: 'text', value: ', ' },
      { type: 'key', value: 'JRA-1' },
      { type: 'text', value: ' và ' },
      { type: 'key', value: 'PROJ-STORY-1' },
    ]);
    expect(splitIssueKeys('MY_APP-12', new Set(['APP-12']))).toEqual([
      { type: 'text', value: 'MY_APP-12' },
    ]);
  });
});
