import { describe, expect, it } from 'vitest';
import { validateSlaForm } from './slaForm';

describe('validateSlaForm', () => {
  it('có tên → hợp lệ ([])', () => {
    expect(validateSlaForm({ name: 'Hỗ trợ tiêu chuẩn' })).toEqual([]);
  });
  it('tên trống hoặc toàn khoảng trắng → lỗi ở trường tên (giữ nguyên câu cũ)', () => {
    const msg = 'Hãy nhập tên cam kết để dễ nhận ra sau này';
    expect(validateSlaForm({ name: '' })).toEqual([{ field: 'name', message: msg }]);
    expect(validateSlaForm({ name: '   ' })).toEqual([{ field: 'name', message: msg }]);
  });
});
