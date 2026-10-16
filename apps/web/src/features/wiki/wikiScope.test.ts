import { describe, expect, it } from 'vitest';
import { askWhoText, canWriteAt, noWriteMessage } from './wikiScope';

describe('canWriteAt', () => {
  const projectCan = (id: string) => (id === 'p1' ? true : id === 'loading' ? undefined : false);

  it('trang chung (null) theo quyền cấp workspace', () => {
    expect(canWriteAt(null, { wsCan: true, projectCan })).toBe(true);
    expect(canWriteAt(null, { wsCan: false, projectCan })).toBe(false);
  });

  it('trang của dự án theo quyền dự án; chưa tải quyền → false (không bày nút rồi 403)', () => {
    expect(canWriteAt('p1', { wsCan: false, projectCan })).toBe(true);
    expect(canWriteAt('p2', { wsCan: true, projectCan })).toBe(false);
    expect(canWriteAt('loading', { wsCan: true, projectCan })).toBe(false);
  });
});

describe('askWhoText', () => {
  it('rỗng → chuỗi rỗng (nơi gọi dùng câu dự phòng)', () => {
    expect(askWhoText([])).toBe('');
  });
  it('1–3 người: liệt kê tên', () => {
    expect(askWhoText(['An'])).toBe(
      'Nhờ An (quản trị) cấp quyền viết tài liệu cho vai trò của bạn.',
    );
    expect(askWhoText(['An', 'Bình'])).toBe(
      'Nhờ An, Bình (quản trị) cấp quyền viết tài liệu cho vai trò của bạn.',
    );
    expect(askWhoText(['An', 'Bình', 'Chi'])).toBe(
      'Nhờ An, Bình, Chi (quản trị) cấp quyền viết tài liệu cho vai trò của bạn.',
    );
  });
  it('> 3 người: 3 tên đầu + "và N người khác"', () => {
    expect(askWhoText(['An', 'Bình', 'Chi', 'Dũng', 'Em'])).toBe(
      'Nhờ An, Bình, Chi và 2 người khác (quản trị) cấp quyền viết tài liệu cho vai trò của bạn.',
    );
  });
});

describe('noWriteMessage', () => {
  it('có quản trị → câu nêu tên', () => {
    expect(noWriteMessage(['An'])).toBe(askWhoText(['An']));
  });
  it('không có quản trị nào → câu dự phòng', () => {
    expect(noWriteMessage([])).toBe(
      'Hãy liên hệ quản trị không gian làm việc để được cấp quyền viết tài liệu.',
    );
  });
});
