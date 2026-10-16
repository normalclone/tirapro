import { describe, expect, it } from 'vitest';
import {
  askWhoText,
  canWriteAt,
  noWriteMessage,
  projectIdsToCheck,
  writeLoadingAt,
} from './wikiScope';

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

describe('quyền theo phạm vi: dự án lưu trữ & không bắn N request (WO-I2, WO-M1)', () => {
  const ctx = {
    wsCan: true,
    projectCan: (id: string) => (id === 'loading' ? undefined : true),
    inactive: (id: string) => id === 'archived',
  };
  it('dự án lưu trữ → không ghi được và KHÔNG kẹt "đang tải"', () => {
    expect(canWriteAt('archived', ctx)).toBe(false);
    expect(writeLoadingAt('archived', ctx)).toBe(false);
  });
  it('dự án đang hoạt động: quyền chưa về = đang tải; có rồi = ghi được; trang chung theo workspace', () => {
    expect(writeLoadingAt('loading', ctx)).toBe(true);
    expect(canWriteAt('loading', ctx)).toBe(false);
    expect(canWriteAt('p1', ctx)).toBe(true);
    expect(writeLoadingAt(null, ctx)).toBe(false);
    expect(canWriteAt(null, ctx)).toBe(true);
  });
  it('chỉ tra quyền cho dự án của phạm vi + trang đang mở (tối đa 2), bỏ trùng/null/lưu trữ', () => {
    expect(projectIdsToCheck(null, null)).toEqual([]);
    expect(projectIdsToCheck('a', undefined)).toEqual(['a']);
    expect(projectIdsToCheck('a', 'b')).toEqual(['a', 'b']);
    expect(projectIdsToCheck('a', 'a')).toEqual(['a']);
    expect(projectIdsToCheck('archived', 'b', ctx.inactive)).toEqual(['b']);
  });
});
