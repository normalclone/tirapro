import { describe, expect, it } from 'vitest';
import { foldCase, isPgFoldSafe } from './case-fold';

describe('foldCase — gấp chữ thường từng ký tự (cùng nghĩa với lower() của Postgres libc)', () => {
  it('chữ Việt: hoa/thường như nhau, Đ ↔ đ, ế ↔ Ế', () => {
    expect(foldCase('LỖI')).toBe('lỗi');
    expect(foldCase('Đường ĐI')).toBe('đường đi');
    expect(foldCase('Ế')).toBe('ế');
  });
  it('không chuẩn hoá Unicode: NFD khác NFC (như ILIKE)', () => {
    expect(foldCase('ế')).not.toBe(foldCase('ế'));
  });
  it('İ (U+0130) → "i" (JS mặc định cho "i̇" 2 ký tự, Postgres cho "i")', () => {
    expect(foldCase('İSTANBUL')).toBe('istanbul');
  });
  it('sigma không phụ thuộc ngữ cảnh: Σ luôn → σ, kể cả cuối từ (JS mặc định cho ς)', () => {
    expect(foldCase('ΟΔΟΣ')).toBe('οδοσ');
    expect(foldCase('Σ')).toBe('σ');
  });
  it('ký tự ngoài BMP không bị tách', () => {
    expect(foldCase('😀A')).toBe('😀a');
  });
});

describe('isPgFoldSafe — chỉ chữ mà JS và Postgres chắc chắn gấp giống nhau', () => {
  it.each([
    ['lỗi Đăng nhập 100% a_b \\ x'],
    ['Kế hoạch'],
    ['👍 xong, ok?'],
    ['ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúý'],
    ['ĂăĐđĨĩŨũƠơƯư'],
    ['ẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ'],
    ['日本語 テスト'],
    [''],
  ])('an toàn: %s', (s) => expect(isPgFoldSafe(s)).toBe(true));
  it.each([
    ['İ'],
    ['ı'],
    ['ǅ'],
    ['ǆ'],
    ['Ǆ'],
    ['ẞ'],
    ['Σ'],
    ['ς'],
    ['ΟΔΟΣ'],
    ['Ύ'],
    ['Я'],
    ['привет'],
    ['µ'],
    ['Ᲊ'],
  ])('KHÔNG an toàn: %s', (s) => expect(isPgFoldSafe(s)).toBe(false));
  it('chỉ cần MỘT ký tự không an toàn là cả chuỗi không an toàn', () => {
    expect(isPgFoldSafe('lỗi Σ')).toBe(false);
  });
});
