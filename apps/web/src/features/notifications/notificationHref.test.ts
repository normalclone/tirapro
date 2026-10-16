import { describe, expect, it } from 'vitest';
import { notificationHref } from './notificationHref';

describe('notificationHref', () => {
  it('thông báo thường → trang công việc', () => {
    expect(notificationHref({ key: 'DEMO-5' })).toBe('/issue/DEMO-5');
  });
  it('thông báo gộp nhập Jira → danh sách (bộ lọc JQL), không chỉ việc đầu tiên', () => {
    const href = notificationHref({
      key: 'PROJ-9',
      bulk: 'jira-import',
      count: 5,
      listJql: 'assignee = me AND key IN ("PROJ-9", "PROJ-2")',
    });
    expect(href).toBe(
      `/filters?jql=${encodeURIComponent('assignee = me AND key IN ("PROJ-9", "PROJ-2")')}`,
    );
  });
  it('gộp nhưng thiếu JQL (dữ liệu cũ) → rơi về việc đầu tiên; không có gì → null', () => {
    expect(notificationHref({ key: 'PROJ-9', bulk: 'jira-import' })).toBe('/issue/PROJ-9');
    expect(notificationHref({})).toBeNull();
    expect(notificationHref(undefined)).toBeNull();
  });
});
