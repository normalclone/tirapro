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

  it('chỉ nhận tab có trong danh sách truyền vào (tab QA do nhóm Q đăng ký sau)', () => {
    const withQa = [...REPORT_TABS, { id: 'qa' as const, label: 'Chất lượng (QA)' }];
    expect(parseReportTab('qa', withQa)).toBe('qa');
    expect(parseReportTab('qa', REPORT_TABS)).toBe('sprint');
  });

  it('tab đầu tiên của danh sách là sprint', () => {
    expect(REPORT_TABS[0]!.id).toBe('sprint');
  });
});
