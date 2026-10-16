import { describe, expect, it } from 'vitest';
import { guessIssueType, splitRequirements } from './heuristic-split';

const sample = [
  'Hệ thống cửa hàng online cần các chức năng sau:',
  '1. Tìm kiếm sản phẩm theo tên; sắp xếp theo giá',
  '2. Giỏ hàng',
  '3. Thanh toán',
  '4. Sửa lỗi: giỏ hàng mất sản phẩm sau khi tải lại',
].join('\n');

describe('splitRequirements', () => {
  it('bỏ dòng dẫn nhập kết thúc bằng ":" và số thứ tự đầu dòng', () => {
    expect(splitRequirements(sample)).toEqual([
      'Tìm kiếm sản phẩm theo tên; sắp xếp theo giá',
      'Giỏ hàng',
      'Thanh toán',
      'Sửa lỗi: giỏ hàng mất sản phẩm sau khi tải lại',
    ]);
  });
  it('không cắt theo dấu ;', () =>
    expect(splitRequirements('Thêm A; thêm B')).toEqual(['Thêm A; thêm B']));
  it('một dòng dài nhiều câu mới cắt theo câu', () => {
    expect(
      splitRequirements('Làm trang đăng nhập. Làm trang đăng ký. Làm trang quên mật khẩu.'),
    ).toHaveLength(3);
  });
  it('nhiều dòng thì KHÔNG cắt thêm theo câu trong từng dòng', () => {
    expect(splitRequirements('Làm trang đăng nhập. Có nhớ phiên.\nLàm trang đăng ký')).toEqual([
      'Làm trang đăng nhập. Có nhớ phiên.',
      'Làm trang đăng ký',
    ]);
  });
  it('ký hiệu đầu dòng -, *, •, 1) bị bỏ; "2FA …" giữ nguyên chữ số đầu', () => {
    expect(
      splitRequirements('- Việc một\n* Việc hai\n• Việc ba\n1) Việc bốn\n2FA cho admin'),
    ).toEqual(['Việc một', 'Việc hai', 'Việc ba', 'Việc bốn', '2FA cho admin']);
  });
  it('chỉ có dòng dẫn nhập → dùng nguyên văn bản', () =>
    expect(splitRequirements('Cần làm gì đó:')).toEqual(['Cần làm gì đó:']));
  it('khử trùng giữ thứ tự, tối đa 15', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Mục số ${i + 1}`).join('\n');
    expect(splitRequirements(many)).toHaveLength(15);
    expect(splitRequirements('Giỏ hàng\nGiỏ hàng\nThanh toán')).toEqual(['Giỏ hàng', 'Thanh toán']);
  });
});
describe('guessIssueType', () => {
  it('Bug', () => {
    expect(guessIssueType('Sửa lỗi: giỏ hàng mất sản phẩm')).toBe('Bug');
    expect(guessIssueType('Ứng dụng crash khi mở ảnh')).toBe('Bug');
    expect(guessIssueType('Nút thanh toán bị hỏng')).toBe('Bug');
  });
  it('không bắt nhầm khi "lỗi"/"sửa" nằm trong từ khác', () => {
    expect(guessIssueType('Thêm trang cài đặt, chỉnh sửa hồ sơ')).toBe('Task');
    expect(guessIssueType('Prefix tên miền')).toBe('Task');
  });
  it('Story', () =>
    expect(guessIssueType('Là người dùng, tôi muốn đặt lại mật khẩu')).toBe('Story'));
  it('Task còn lại', () => expect(guessIssueType('Giỏ hàng')).toBe('Task'));
});
