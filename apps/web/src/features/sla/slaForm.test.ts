import { describe, expect, it } from 'vitest';
import { validateSlaForm, findSlaScopeOverlaps } from './slaForm';

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

describe('findSlaScopeOverlaps (TIRA-BUG-30)', () => {
  const all = (active: boolean) => ({ active, priorityId: null });
  it('hai cam kết "mọi mức ưu tiên" cùng bật → một nhóm trùng', () => {
    const r = findSlaScopeOverlaps([all(true), all(true)]);
    expect(r).toEqual([{ priorityName: null, count: 2 }]);
  });
  it('bỏ qua cam kết đang tắt', () => {
    expect(findSlaScopeOverlaps([all(true), all(false)])).toEqual([]);
  });
  it('không trùng khi mỗi cam kết một mức ưu tiên khác nhau', () => {
    const r = findSlaScopeOverlaps([
      { active: true, priorityId: 'high', priority: { name: 'Cao' } },
      { active: true, priorityId: 'low', priority: { name: 'Thấp' } },
      all(true),
    ]);
    expect(r).toEqual([]);
  });
  it('hai cam kết cùng một mức ưu tiên cụ thể → trùng, kèm tên mức', () => {
    const r = findSlaScopeOverlaps([
      { active: true, priorityId: 'high', priority: { name: 'Cao' } },
      { active: true, priorityId: 'high', priority: { name: 'Cao' } },
    ]);
    expect(r).toEqual([{ priorityName: 'Cao', count: 2 }]);
  });
});
