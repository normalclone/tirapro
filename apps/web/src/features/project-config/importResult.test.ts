import { describe, expect, it } from 'vitest';
import { importResultMessage } from './importResult';

describe('importResultMessage', () => {
  it('thành công trơn: như cũ', () => {
    expect(importResultMessage({ created: 3, failed: 0, total: 3, skippedAssignees: 0 })).toEqual({
      level: 'success',
      text: 'Đã nhập thành công 3/3 công việc.',
    });
  });
  it('API cũ chưa có skippedAssignees: coi như 0', () => {
    expect(importResultMessage({ created: 1, failed: 0, total: 1 }).level).toBe('success');
  });
  it('có việc lỗi: cảnh báo', () => {
    expect(importResultMessage({ created: 2, failed: 1, total: 3, skippedAssignees: 0 })).toEqual({
      level: 'warning',
      text: 'Đã nhập 2/3 công việc · 1 việc lỗi.',
    });
  });
  it('skippedAssignees > 0: cảnh báo kèm số người bị bỏ gán, kể cả khi không có việc lỗi', () => {
    const r = importResultMessage({ created: 3, failed: 0, total: 3, skippedAssignees: 2 });
    expect(r.level).toBe('warning');
    expect(r.text).toContain('Đã nhập thành công 3/3');
    expect(r.text).toContain('2 người phụ trách không khớp thành viên nào — đã bỏ gán');
  });
  it('vừa lỗi vừa bỏ gán: gộp cả hai', () => {
    const r = importResultMessage({ created: 2, failed: 1, total: 3, skippedAssignees: 1 });
    expect(r.text).toContain('1 việc lỗi');
    expect(r.text).toContain('1 người phụ trách');
  });
});
