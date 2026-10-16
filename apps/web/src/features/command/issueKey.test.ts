import { describe, expect, it } from 'vitest';
import { guessIssueKey } from './issueKey';

describe('guessIssueKey (L27) — hai kiểu mã cùng tồn tại', () => {
  it('mã Tirapro PROJ-TYPE-N', () => {
    expect(guessIssueKey('DEMO-BUG-1')).toBe('DEMO-BUG-1');
    expect(guessIssueKey(' demo-story-12 ')).toBe('DEMO-STORY-12');
  });
  it('mã Jira gốc KEY-N, kể cả khoá có gạch dưới', () => {
    expect(guessIssueKey('JRA-1')).toBe('JRA-1');
    expect(guessIssueKey('proj-2')).toBe('PROJ-2');
    expect(guessIssueKey('my_app-12')).toBe('MY_APP-12');
  });
  it('không phải mã → null (để rơi về tìm văn bản)', () => {
    expect(guessIssueKey('thanh toán')).toBeNull();
    expect(guessIssueKey('JRA')).toBeNull();
    expect(guessIssueKey('JRA-')).toBeNull();
    expect(guessIssueKey('-1')).toBeNull();
    expect(guessIssueKey('1-2')).toBeNull();
    expect(guessIssueKey('xem JRA-1')).toBeNull();
    expect(guessIssueKey('')).toBeNull();
  });
});
