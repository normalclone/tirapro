import { describe, expect, it } from 'vitest';
import {
  attachmentMarkdown,
  imageFilesFromClipboard,
  insertPlaceholder,
  isTooLarge,
  MAX_PASTE_BYTES,
  pastedImageName,
  replacePlaceholder,
} from './pasteImage';

const file = (name: string, type: string, size = 10) => ({ name, type, size }) as File;

describe('imageFilesFromClipboard', () => {
  it('chỉ lấy file ảnh an toàn (không svg)', () => {
    const out = imageFilesFromClipboard([
      file('image.png', 'image/png'),
      file('a.svg', 'image/svg+xml'),
      file('b.pdf', 'application/pdf'),
    ]);
    expect(out.map((f) => f.name)).toEqual(['image.png']);
  });
});

describe('pastedImageName', () => {
  it('đặt tên theo thời gian, giữ đuôi theo mime', () => {
    expect(pastedImageName(file('image.png', 'image/png'), new Date('2026-10-16T03:04:05'))).toBe(
      'anh-dan-20261016-030405.png',
    );
    expect(pastedImageName(file('x', 'image/jpeg'), new Date('2026-10-16T03:04:05'))).toBe(
      'anh-dan-20261016-030405.jpg',
    );
  });

  it('nhiều ảnh dán cùng giây: ảnh thứ hai trở đi có hậu tố để không trùng tên', () => {
    const now = new Date('2026-10-16T03:04:05');
    const f = file('image.png', 'image/png');
    expect(pastedImageName(f, now, 0)).toBe('anh-dan-20261016-030405.png');
    expect(pastedImageName(f, now, 1)).toBe('anh-dan-20261016-030405-2.png');
    expect(pastedImageName(f, now, 2)).toBe('anh-dan-20261016-030405-3.png');
  });
});

describe('placeholder', () => {
  it('chèn tại con trỏ rồi thay đúng id', () => {
    const r = insertPlaceholder('Xem lỗi: ', 9, 1);
    expect(r.value).toBe('Xem lỗi: ![Đang tải ảnh-1…]()');
    expect(r.caret).toBe(r.value.length);
    expect(replacePlaceholder(r.value, 1, '![a.png](attachment:x1)')).toBe(
      'Xem lỗi: ![a.png](attachment:x1)',
    );
    expect(replacePlaceholder(r.value, 1, '')).toBe('Xem lỗi: ');
    expect(replacePlaceholder(r.value, 2, 'zzz')).toBe(r.value);
  });

  it('chèn giữa văn bản: phần sau con trỏ giữ nguyên; id 1 không nhầm với id 10', () => {
    const r = insertPlaceholder('abcdef', 3, 10);
    expect(r.value).toBe('abc![Đang tải ảnh-10…]()def');
    expect(replacePlaceholder(r.value, 1, 'X')).toBe(r.value);
  });

  it('thay bằng chuỗi chứa $& không bị hiểu là mẫu thay thế', () => {
    const r = insertPlaceholder('', 0, 1);
    expect(replacePlaceholder(r.value, 1, '![$&](attachment:a)')).toBe('![$&](attachment:a)');
  });
});

describe('isTooLarge', () => {
  it('chặn ảnh vượt 25 MB', () => {
    expect(MAX_PASTE_BYTES).toBe(25 * 1024 * 1024);
    expect(isTooLarge(file('a.png', 'image/png', MAX_PASTE_BYTES))).toBe(false);
    expect(isTooLarge(file('a.png', 'image/png', MAX_PASTE_BYTES + 1))).toBe(true);
  });
});

describe('attachmentMarkdown', () => {
  it('dựng ![tên](attachment:ID), bỏ ký tự phá cú pháp trong tên', () => {
    expect(attachmentMarkdown('a.png', 'attachment:x1')).toBe('![a.png](attachment:x1)');
    expect(attachmentMarkdown('a](javascript:alert(1)).png', 'attachment:x1')).toBe(
      '![ajavascript:alert1.png](attachment:x1)',
    );
  });
});
