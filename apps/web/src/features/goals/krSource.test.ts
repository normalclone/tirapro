import { describe, expect, it } from 'vitest';
import { defaultConfig, describeSource, isAutoSource, isSourceConfigComplete } from './krSource';

describe('krSource', () => {
  it('defaultConfig: nhập tay không có cấu hình, các nguồn khác có khung rỗng', () => {
    expect(defaultConfig('MANUAL')).toBeNull();
    expect(defaultConfig('OPEN_BUGS')).toEqual({});
    expect(defaultConfig('SPRINT_COMPLETION')).toEqual({ projectId: '' });
    expect(defaultConfig('ISSUE_COUNT_JQL')).toEqual({ jql: '' });
  });

  it('isAutoSource', () => {
    expect(isAutoSource('MANUAL')).toBe(false);
    expect(isAutoSource('OPEN_BUGS')).toBe(true);
  });

  it('describeSource: câu giải thích nguồn, nhắc số tính theo dự án bạn có quyền xem', () => {
    expect(describeSource({ source: 'MANUAL', sourceConfig: null })).toBe('Nhập tay');
    expect(describeSource({ source: 'OPEN_BUGS', sourceConfig: {} })).toBe(
      'Số bug đang mở trong mọi dự án bạn có quyền xem',
    );
    expect(
      describeSource({ source: 'OPEN_BUGS', sourceConfig: { projectId: 'p1' } }, { p1: 'DEMO' }),
    ).toBe('Số bug đang mở của dự án DEMO');
    expect(
      describeSource(
        { source: 'SPRINT_COMPLETION', sourceConfig: { projectId: 'p1' } },
        { p1: 'DEMO' },
      ),
    ).toBe('% điểm hoàn tất của sprint hiện tại (hoặc vừa đóng) — dự án DEMO');
    expect(
      describeSource({ source: 'ISSUE_COUNT_JQL', sourceConfig: { jql: 'statusCategory = DONE' } }),
    ).toBe('Số công việc khớp JQL: statusCategory = DONE (trong dự án bạn có quyền xem)');
  });

  it('isSourceConfigComplete: đủ cấu hình mới cho lưu', () => {
    expect(isSourceConfigComplete('MANUAL', null)).toBe(true);
    expect(isSourceConfigComplete('OPEN_BUGS', {})).toBe(true);
    expect(isSourceConfigComplete('SPRINT_COMPLETION', { projectId: '' })).toBe(false);
    expect(isSourceConfigComplete('SPRINT_COMPLETION', { projectId: 'p1' })).toBe(true);
    expect(isSourceConfigComplete('ISSUE_COUNT_JQL', { jql: '  ' })).toBe(false);
    expect(isSourceConfigComplete('ISSUE_COUNT_JQL', { jql: 'x'.repeat(501) })).toBe(false);
    expect(isSourceConfigComplete('ISSUE_COUNT_JQL', { jql: 'type = Bug' })).toBe(true);
  });
});
