import { describe, expect, it } from 'vitest';
import { contentDispositionAttachment, fixLatin1Utf8 } from './filename';

/** Mô phỏng đúng lỗi của busboy/multer: byte UTF-8 của tên bị đọc như latin1. */
const mangle = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

describe('fixLatin1Utf8 — sửa tên tệp tiếng Việt bị multer giải mã latin1', () => {
  it.each([
    'báo cáo tháng 10.pdf',
    'Đặc tả yêu cầu — v2.docx',
    'ảnh_chụp_màn_hình.png',
    'tài liệu 日本語.txt',
  ])('khôi phục %s', (name) => {
    expect(fixLatin1Utf8(mangle(name))).toBe(name);
  });

  it('tên ASCII thuần giữ nguyên', () => {
    expect(fixLatin1Utf8('report 2026.pdf')).toBe('report 2026.pdf');
  });

  it('tên đã là UTF-8 đúng (có ký tự > U+00FF) giữ nguyên — client gửi đúng chuẩn', () => {
    expect(fixLatin1Utf8('báo cáo tháng 10.pdf')).toBe('báo cáo tháng 10.pdf');
    expect(fixLatin1Utf8('Đặc tả.docx')).toBe('Đặc tả.docx');
  });

  it('latin1 thật không giải mã sạch (có U+FFFD) giữ nguyên', () => {
    expect(fixLatin1Utf8('café.txt')).toBe('café.txt');
    expect(fixLatin1Utf8('Müller Straße.pdf')).toBe('Müller Straße.pdf');
  });

  it('chuỗi rỗng / không phải chuỗi không làm hỏng gì', () => {
    expect(fixLatin1Utf8('')).toBe('');
  });
});

describe('contentDispositionAttachment — RFC 6266/5987', () => {
  it("tên tiếng Việt: filename ASCII dự phòng + filename*=UTF-8'' percent-encode", () => {
    const h = contentDispositionAttachment('báo cáo tháng 10.pdf');
    expect(h).toBe(
      `attachment; filename="bao cao thang 10.pdf"; filename*=UTF-8''b%C3%A1o%20c%C3%A1o%20th%C3%A1ng%2010.pdf`,
    );
  });

  it('đ/Đ được bỏ dấu đúng ở bản dự phòng', () => {
    expect(contentDispositionAttachment('Đặc tả đủ.docx')).toContain('filename="Dac ta du.docx"');
  });

  it('tên ASCII: vẫn có cả hai tham số', () => {
    expect(contentDispositionAttachment('a.txt')).toBe(
      `attachment; filename="a.txt"; filename*=UTF-8''a.txt`,
    );
  });

  it('chống chèn header: dấu ngoặc kép, xuống dòng, dấu chấm phẩy, gạch chéo không thoát được khỏi giá trị', () => {
    const h = contentDispositionAttachment('a"b\r\nSet-Cookie: x=1;\\..\\c/d.txt');
    expect(h).not.toMatch(/[\r\n]/);
    const fallback = /filename="([^"]*)"/.exec(h)?.[1] ?? '';
    expect(fallback).not.toMatch(/["\\\r\n;/]/);
    // đúng 2 dấu " (mở/đóng) => không có dấu ngoặc kép lọt ra
    expect((h.match(/"/g) ?? []).length).toBe(2);
    const ext = /filename\*=UTF-8''(\S*)$/.exec(h)?.[1] ?? '';
    expect(ext).toMatch(/^[A-Za-z0-9%._~!$&+-]*$/);
    expect(decodeURIComponent(ext)).toContain('Set-Cookie');
  });

  it('tên rỗng/toàn ký tự lạ → tên dự phòng "file"', () => {
    expect(contentDispositionAttachment('')).toContain('filename="file"');
    expect(contentDispositionAttachment('日本語.txt')).toContain('filename="___.txt"');
  });

  it("ký tự ' ( ) * trong filename* được mã hoá (RFC 5987 attr-char)", () => {
    const ext =
      /filename\*=UTF-8''(\S*)$/.exec(contentDispositionAttachment("a'b(c)*.txt"))?.[1] ?? '';
    expect(ext).toBe('a%27b%28c%29%2A.txt');
  });

  it('N3: surrogate lẻ (tên tệp lỗi) KHÔNG làm ném URIError; thay bằng U+FFFD rồi mã hoá', () => {
    for (const bad of ['a\uD800b.txt', 'a\uDC00b.txt', '\uD83D', 'x\uD83Dy\uDE00z']) {
      expect(() => contentDispositionAttachment(bad)).not.toThrow();
    }
    const h = contentDispositionAttachment('a\uD800b.txt');
    expect(h).toContain("filename*=UTF-8''a%EF%BF%BDb.txt");
    expect(h).toContain('filename="a_b.txt"');
  });

  it('N3: cặp surrogate hợp lệ (emoji) vẫn được mã hoá đúng', () => {
    expect(contentDispositionAttachment('a😀.txt')).toContain("filename*=UTF-8''a%F0%9F%98%80.txt");
  });
});
