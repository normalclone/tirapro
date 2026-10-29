import { describe, expect, it } from 'vitest';
import { insertTableTemplate, toggleLinePrefix } from './markdownEdit';

describe('toggleLinePrefix', () => {
  it('thêm cho mọi dòng trong vùng chọn, rồi bỏ khi tất cả đã có', () => {
    const v = 'a\nb\nc';
    const on = toggleLinePrefix(v, 0, 3, '- [ ] ');
    expect(on.value).toBe('- [ ] a\n- [ ] b\nc');
    const off = toggleLinePrefix(on.value, 0, on.selEnd, '- [ ] ');
    expect(off.value).toBe(v);
  });
  it('dòng đã là "- [x] " cũng được bỏ khi bấm', () => {
    expect(toggleLinePrefix('- [x] a', 3, 3, '- [ ] ').value).toBe('a');
  });
  it('con trỏ không chọn gì → chỉ dòng hiện tại', () => {
    expect(toggleLinePrefix('x\ny', 3, 3, '- [ ] ').value).toBe('x\n- [ ] y');
  });
});

describe('toggleLinePrefix — biên', () => {
  it('bỏ qua dòng trống trong vùng chọn nhiều dòng', () => {
    const r = toggleLinePrefix('a\n\nb', 0, 4, '- [ ] ');
    expect(r.value).toBe('- [ ] a\n\n- [ ] b');
  });
  it('một số dòng đã có tiền tố → thêm cho dòng còn thiếu, không nhân đôi', () => {
    expect(toggleLinePrefix('- [x] a\nb', 0, 9, '- [ ] ').value).toBe('- [x] a\n- [ ] b');
  });
  it('chọn nguyên dòng (kết thúc sau \\n) không kéo dòng kế tiếp vào', () => {
    expect(toggleLinePrefix('a\nb', 0, 2, '- [ ] ').value).toBe('- [ ] a\nb');
  });
  it('dòng trống duy nhất vẫn nhận tiền tố; văn bản bắt đầu bằng xuống dòng không lệch', () => {
    expect(toggleLinePrefix('', 0, 0, '- [ ] ').value).toBe('- [ ] ');
    expect(toggleLinePrefix('\nx', 0, 0, '- [ ] ').value).toBe('- [ ] \nx');
  });
});

describe('insertTableTemplate', () => {
  it('chèn bảng 3 cột trên dòng riêng, có dòng trống phía trước, chọn sẵn "Cột 1"', () => {
    const r = insertTableTemplate('Mô tả', 5);
    expect(r.value).toBe('Mô tả\n\n| Cột 1 | Cột 2 | Cột 3 |\n| --- | --- | --- |\n|  |  |  |\n');
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('Cột 1');
  });
  it('đầu văn bản trống → không thêm dòng trống thừa', () => {
    expect(insertTableTemplate('', 0).value.startsWith('| Cột 1')).toBe(true);
  });
});
