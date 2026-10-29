import { describe, expect, it } from 'vitest';
import { validateCreateIssue } from './createIssueForm';

const ok = {
  projectId: 'p1',
  metaReady: true,
  typeId: 't1',
  summary: 'Sửa lỗi',
  cleanSummary: 'Sửa lỗi',
};

describe('validateCreateIssue', () => {
  it('đủ dự án, loại, tiêu đề → []', () => {
    expect(validateCreateIssue(ok)).toEqual([]);
  });
  it('báo ĐỦ mọi lỗi theo thứ tự trong form: dự án → loại → tiêu đề', () => {
    const r = validateCreateIssue({
      projectId: '',
      metaReady: true,
      typeId: '',
      summary: '',
      cleanSummary: '',
    });
    expect(r.map((e) => e.field)).toEqual(['project', 'summary']);
  });
  it('chưa chọn loại (dự án đã có, meta đã tải) → lỗi loại', () => {
    expect(validateCreateIssue({ ...ok, typeId: '' }).map((e) => e.field)).toEqual(['type']);
  });
  it('meta chưa tải thì chưa tính thiếu loại (không phải lỗi người dùng)', () => {
    expect(validateCreateIssue({ ...ok, typeId: '', metaReady: false })).toEqual([]);
  });
  it('chưa chọn dự án thì không đòi loại (chưa có danh sách loại)', () => {
    const r = validateCreateIssue({ ...ok, projectId: '', metaReady: false, typeId: '' });
    expect(r.map((e) => e.field)).toEqual(['project']);
  });
  it('tiêu đề trống hoặc sau khi lược token chỉ còn rỗng → lỗi tiêu đề (cùng câu cũ)', () => {
    const msg = 'Hãy nhập tiêu đề mô tả việc cần làm';
    expect(validateCreateIssue({ ...ok, summary: '  ', cleanSummary: '' })).toEqual([
      { field: 'summary', message: msg },
    ]);
    expect(validateCreateIssue({ ...ok, summary: '!cao @an', cleanSummary: '  ' })).toEqual([
      { field: 'summary', message: msg },
    ]);
  });
});
