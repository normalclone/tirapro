import { describe, expect, it } from 'vitest';
import { isIssueKey } from './markdown-text';
import { isJiraKey, isTiraproKey, issueTypePrefix, normalizeJiraKey } from './issue-key';

describe('normalizeJiraKey (L27)', () => {
  it('trim + HOA', () => {
    expect(normalizeJiraKey(' jra-12 ')).toBe('JRA-12');
  });
  it('khoá Jira có gạch dưới hợp lệ', () => {
    expect(normalizeJiraKey('MY_APP-3')).toBe('MY_APP-3');
  });
  it.each(['JRA-STORY-1', 'JRA-', '-1', 'JRA 1', 'A-1-2', '', '1A-2', 'JRA-0x1'])(
    'sai dạng "%s" → null',
    (raw) => {
      expect(normalizeJiraKey(raw)).toBeNull();
    },
  );
  it('quá 40 ký tự → null', () => {
    expect(normalizeJiraKey(`${'A'.repeat(40)}-1`)).toBeNull();
    expect(normalizeJiraKey(`${'A'.repeat(30)}-1`)).toBe(`${'A'.repeat(30)}-1`);
  });
  it('không phải chuỗi → null', () => {
    expect(normalizeJiraKey(undefined)).toBeNull();
    expect(normalizeJiraKey(null)).toBeNull();
  });
});

describe('isJiraKey / isTiraproKey (L27) — hai dải mã rời nhau', () => {
  it('nhận dạng đúng từng kiểu', () => {
    expect(isTiraproKey('JRA-STORY-1')).toBe(true);
    expect(isTiraproKey('JRA-1')).toBe(false);
    expect(isJiraKey('JRA-1')).toBe(true);
    expect(isJiraKey('JRA-STORY-1')).toBe(false);
  });
  it('mã Jira hợp lệ không bao giờ khớp isTiraproKey (và ngược lại)', () => {
    const jira = ['JRA-1', 'A-99', 'MY_APP-12', 'X1-100000'];
    const tira = ['PROJ-STORY-1', 'P-BUG-3'];
    for (const k of jira) {
      expect(isJiraKey(k)).toBe(true);
      expect(isTiraproKey(k)).toBe(false);
    }
    for (const k of tira) {
      expect(isTiraproKey(k)).toBe(true);
      expect(isJiraKey(k)).toBe(false);
    }
    // loại tên "1" cho ra PROJ-1-9: vẫn là mã Tirapro (hai gạch), không phải mã Jira
    expect(isTiraproKey('PROJ-1-9')).toBe(true);
    expect(isJiraKey('PROJ-1-9')).toBe(false);
  });
});

describe('issueTypePrefix — tiền tố loại luôn bắt đầu bằng chữ (Q-M5a)', () => {
  it('loại hệ thống giữ nguyên tiền tố', () => {
    expect(issueTypePrefix('BUG', 'Lỗi')).toBe('BUG');
    expect(issueTypePrefix('SUBTASK', 'Sub-task')).toBe('SUB');
  });

  it.each([
    ['3D Model', 'DMOD'],
    ['2024 Roadmap', 'ROAD'],
    ['  7up', 'UP'],
    ['Design', 'DESI'],
    ['QA-Test', 'QATE'],
    ['Lỗi', 'LI'],
  ])('tên "%s" → %s', (name, expected) => {
    expect(issueTypePrefix(null, name)).toBe(expected);
  });

  it.each(['123', '', '___', 'ƒƒ', '9'])('tên "%s" không còn chữ → ISSUE (dự phòng)', (name) => {
    expect(issueTypePrefix(null, name)).toBe('ISSUE');
  });

  it('mã sinh ra luôn là mã công việc hợp lệ (isIssueKey) và là mã Tirapro', () => {
    for (const name of ['3D Model', '2024 Roadmap', '123', 'Design', 'Lỗi']) {
      const key = `PROJ-${issueTypePrefix(null, name)}-1`;
      expect(isIssueKey(key), key).toBe(true);
      expect(isTiraproKey(key), key).toBe(true);
    }
  });
});
