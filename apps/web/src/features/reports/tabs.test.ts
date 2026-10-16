import { describe, expect, it } from 'vitest';
import { REPORT_TABS, parseReportTab } from './tabs';

describe('parseReportTab', () => {
  it('giá trị hợp lệ giữ nguyên', () => {
    expect(parseReportTab('overview')).toBe('overview');
    expect(parseReportTab('flow')).toBe('flow');
  });

  it('thiếu hoặc lạ → sprint (tab đứng đầu)', () => {
    expect(parseReportTab(null)).toBe('sprint');
    expect(parseReportTab('')).toBe('sprint');
    expect(parseReportTab('hack')).toBe('sprint');
  });

  it('tab QA đã đăng ký; chỉ nhận tab có trong danh sách truyền vào', () => {
    expect(parseReportTab('qa')).toBe('qa');
    expect(
      parseReportTab(
        'qa',
        REPORT_TABS.filter((t) => t.id !== 'qa'),
      ),
    ).toBe('sprint');
  });

  it('tab đầu tiên của danh sách là sprint', () => {
    expect(REPORT_TABS[0]!.id).toBe('sprint');
  });
});
