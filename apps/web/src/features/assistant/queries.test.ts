import { parseJql } from '@tirapro/shared';
import { describe, expect, it } from 'vitest';
import { dueJql, filtersHref, myIssuesJql, overdueJql, searchJql } from './queries';

describe('JQL của Trợ lý', () => {
  const all = [
    myIssuesJql(),
    myIssuesJql('DEMO'),
    overdueJql(),
    overdueJql('DEMO'),
    dueJql('week'),
    dueJql('today', 'DEMO'),
    searchJql('đăng nhập'),
    searchJql('lỗi "nặng" \\ x', 'DEMO'),
  ];
  it('mọi câu parse được bằng parser thật (không lỗi cú pháp)', () => {
    for (const q of all) expect(() => parseJql(q), q).not.toThrow();
  });
  it('trong dự án thì giới hạn project, ngoài dự án thì toàn workspace', () => {
    expect(myIssuesJql('DEMO')).toContain('project = "DEMO"');
    expect(myIssuesJql()).not.toContain('project');
  });
  it('quá hạn = hạn trước hôm nay và chưa Done', () => {
    expect(overdueJql()).toBe('due < startOfDay() AND statusCategory != DONE ORDER BY due ASC');
  });
  it('đến hạn tuần này / hôm nay', () => {
    expect(dueJql('week')).toContain('due <= endOfWeek()');
    expect(dueJql('today')).toContain('due <= endOfDay()');
  });
  it('từ khoá người dùng được thoát nháy kép và backslash (không chèn được điều kiện JQL)', () => {
    const q = searchJql('x" OR project = "Y');
    expect(q).toContain('text ~ "x\\" OR project = \\"Y"');
    expect(() => parseJql(q)).not.toThrow();
  });
  it('"Xem tất cả" trỏ trang Bộ lọc với JQL mã hoá', () => {
    const jql = overdueJql('A B');
    expect(filtersHref(jql)).toBe(`/filters?jql=${encodeURIComponent(jql)}`);
    expect(new URL(filtersHref(jql), 'http://x').searchParams.get('jql')).toBe(jql);
  });
});
