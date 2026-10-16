import { describe, expect, it } from 'vitest';
import { exportEmptyMessage, exportResultToast, issuesCsvParams } from './api';

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
    const t = exportResultToast(true, true);
    expect(t.kind).toBe('warning');
    expect(t.text).toMatch(/5\.000/);
    expect(t.text).toMatch(/thu hẹp bộ lọc/);
  });
  it('bị cắt ở nơi không có bộ lọc → không khuyên thu hẹp bộ lọc', () => {
    const t = exportResultToast(true);
    expect(t.text).toMatch(/5\.000/);
    expect(t.text).not.toMatch(/bộ lọc/);
  });
  it('đủ → xác nhận', () => {
    expect(exportResultToast(false).kind).toBe('success');
  });
});

describe('exportEmptyMessage', () => {
  it('sprint rỗng nói rõ là sprint', () => {
    expect(exportEmptyMessage({ sprintId: 's1' })).toBe('Sprint chưa có việc nào để xuất.');
    expect(exportEmptyMessage({})).toBe('Không có công việc nào để xuất.');
  });
});
