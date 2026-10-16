import { describe, expect, it } from 'vitest';
import { applyDidYouMean, applySuggestion } from './jqlEditorModel';

// Quy tắc: thay [from,to) bằng insert; nếu ký tự ngay sau `to` không phải khoảng trắng (hoặc hết chuỗi) thì chèn thêm đúng 1 khoảng trắng;
// con trỏ đặt ngay sau phần đã chèn (kể cả khoảng trắng thêm).
describe('applySuggestion', () => {
  it('thay đúng đoạn đang gõ ở cuối chuỗi, thêm 1 khoảng trắng, con trỏ ở cuối', () => {
    const r = applySuggestion(
      'status = In',
      { from: 9, to: 11, items: [] },
      { label: 'In Progress', insert: '"In Progress"', kind: 'value' },
    );
    expect(r.text).toBe('status = "In Progress" ');
    expect(r.caret).toBe(r.text.length);
  });
  it('phía sau đã có khoảng trắng thì KHÔNG thêm; giữ phần văn bản sau con trỏ', () => {
    const r = applySuggestion(
      'sta = Done',
      { from: 0, to: 3, items: [] },
      { label: 'status', insert: 'status', kind: 'field' },
    );
    expect(r.text).toBe('status = Done');
    expect(r.caret).toBe(6);
  });
  it('hàm có ngoặc', () => {
    const r = applySuggestion(
      'assignee = cur',
      { from: 11, to: 14, items: [] },
      { label: 'currentUser()', insert: 'currentUser()', kind: 'function' },
    );
    expect(r.text).toBe('assignee = currentUser() ');
  });
  it('"(" mở danh sách: không thêm khoảng trắng sau', () => {
    const r = applySuggestion(
      'status IN ',
      { from: 10, to: 10, items: [] },
      { label: '(', insert: '(', kind: 'keyword' },
    );
    expect(r.text).toBe('status IN (');
    expect(r.caret).toBe(r.text.length);
  });
});

describe('applyDidYouMean', () => {
  it('thay giá trị sai (bare hoặc trong nháy) bằng giá trị đúng, bọc nháy khi cần', () => {
    expect(
      applyDidYouMean('status = "In Progresss"', 'status', 'In Progresss', 'In Progress'),
    ).toBe('status = "In Progress"');
    expect(applyDidYouMean('status = Dne', 'status', 'Dne', 'Done')).toBe('status = Done');
    expect(applyDidYouMean('status = Dne', 'status', 'Dne', 'To Do')).toBe('status = "To Do"');
  });
  it('chỉ thay ở điều kiện của đúng trường, không đụng giá trị trùng ở trường khác', () => {
    expect(applyDidYouMean('resolution = Dne AND status = Dne', 'status', 'Dne', 'Done')).toBe(
      'resolution = Dne AND status = Done',
    );
  });
  it('trong IN (…) và không phân biệt hoa thường', () => {
    expect(applyDidYouMean('status IN (done, Dne)', 'status', 'DNE', 'Done')).toBe(
      'status IN (done, Done)',
    );
  });
  it('không tìm thấy → giữ nguyên', () => {
    expect(applyDidYouMean('status = Done', 'status', 'zzz', 'Done')).toBe('status = Done');
  });
});
