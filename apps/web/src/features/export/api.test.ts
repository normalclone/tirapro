import { describe, expect, it } from 'vitest';
import { exportResultToast, issuesCsvParams } from './api';

describe('issuesCsvParams', () => {
  it('chỉ đưa tham số có giá trị; cột nối bằng dấu phẩy', () => {
    expect(
      issuesCsvParams({
        jql: '  type = Bug  ',
        projectId: 'p1',
        columns: ['key', 'summary', 'sprint'],
        preset: undefined,
        sprintId: '',
      }),
    ).toEqual({ jql: 'type = Bug', projectId: 'p1', columns: 'key,summary,sprint' });
  });

  it('preset + dự án; không columns thì không gửi (máy chủ dùng đủ cột)', () => {
    expect(issuesCsvParams({ projectId: 'p1', preset: 'bugs', columns: [] })).toEqual({
      projectId: 'p1',
      preset: 'bugs',
    });
  });
});

describe('exportResultToast', () => {
  it('bị cắt → cảnh báo nêu 5.000 và gợi ý thu hẹp bộ lọc', () => {
    const t = exportResultToast(true);
    expect(t.kind).toBe('warning');
    expect(t.text).toMatch(/5\.000/);
    expect(t.text).toMatch(/thu hẹp bộ lọc/);
  });
  it('đủ → xác nhận', () => {
    expect(exportResultToast(false).kind).toBe('success');
  });
});
