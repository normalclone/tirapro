import { describe, expect, it } from 'vitest';
import { isJiraKey, isTiraproKey, normalizeJiraKey } from './issue-key';

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
