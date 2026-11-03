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

  it('tiêu đề quá 255 ký tự → thông báo nêu giới hạn và số ký tự đang có (#13)', () => {
    const long = 'a'.repeat(256);
    const r = validateCreateIssue({ ...ok, summary: long, cleanSummary: long });
    expect(r).toHaveLength(1);
    expect(r[0]!.message).toContain('255');
    expect(r[0]!.message).toContain('256');
    const exact = 'a'.repeat(255);
    expect(validateCreateIssue({ ...ok, summary: exact, cleanSummary: exact })).toEqual([]);
  });
  it('điểm ước lượng tối đa 100 (#11)', () => {
    expect(validateCreateIssue({ ...ok, points: '100' })).toEqual([]);
    expect(validateCreateIssue({ ...ok, points: '101' })[0]).toMatchObject({
      field: 'points',
      message: 'Điểm tối đa 100',
    });
  });
  it('hạn trước ngày tạo → lỗi ở ô hạn (#10)', () => {
    expect(validateCreateIssue({ ...ok, dueInPast: true })[0]?.field).toBe('due');
  });
});
