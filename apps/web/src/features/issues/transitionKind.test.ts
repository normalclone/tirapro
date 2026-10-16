import { describe, expect, it } from 'vitest';
import { appendReason, defaultResolutionId, transitionKind } from './transitionKind';

const s = (category: 'TODO' | 'IN_PROGRESS' | 'DONE', order: number) => ({ category, order });

describe('transitionKind', () => {
  it('đóng / mở lại / trả lại / tiến', () => {
    expect(transitionKind(s('IN_PROGRESS', 2), s('DONE', 3))).toBe('close');
    expect(transitionKind(s('DONE', 3), s('TODO', 0))).toBe('reopen');
    expect(transitionKind(s('IN_PROGRESS', 2), s('IN_PROGRESS', 1))).toBe('return');
    expect(transitionKind(s('TODO', 0), s('IN_PROGRESS', 1))).toBe('forward');
    expect(transitionKind(s('IN_PROGRESS', 2), s('TODO', 0))).toBe('return'); // "Tạm dừng" cũng là đi ngược
    expect(transitionKind(s('DONE', 3), s('DONE', 4))).toBe('forward');
  });
});

describe('defaultResolutionId', () => {
  it('lấy mức isDefault; không có thì mức đầu; rỗng => null', () => {
    expect(
      defaultResolutionId([
        { id: 'a', isDefault: false },
        { id: 'b', isDefault: true },
      ]),
    ).toBe('b');
    expect(defaultResolutionId([{ id: 'a', isDefault: false }])).toBe('a');
    expect(defaultResolutionId([])).toBeNull();
  });
});

describe('appendReason', () => {
  it('ô trống => đúng chip; có chữ => nối, không nhân đôi', () => {
    expect(appendReason('', 'Chưa sửa được')).toBe('Chưa sửa được');
    expect(appendReason('Vẫn lỗi trên iOS.', 'Thiếu thông tin')).toBe(
      'Vẫn lỗi trên iOS, thiếu thông tin',
    );
    expect(appendReason('Chưa sửa được', 'Chưa sửa được')).toBe('Chưa sửa được');
  });
});
