import { describe, expect, it } from 'vitest';
import { parseFields } from './activity.fields';

describe('parseFields (B19)', () => {
  it('CSV, khoảng trắng, trùng lặp', () => {
    expect(parseFields('STATUS, DESCRIPTION ,STATUS')).toEqual(['STATUS', 'DESCRIPTION']);
  });
  it('lặp tham số (mảng) không ném TypeError', () => {
    expect(parseFields(['STATUS', 'PRIORITY,DESCRIPTION'])).toEqual([
      'STATUS',
      'PRIORITY',
      'DESCRIPTION',
    ]);
  });
  it('rỗng/thiếu => không lọc', () => {
    expect(parseFields(undefined)).toBeUndefined();
    expect(parseFields('')).toBeUndefined();
    expect(parseFields([])).toBeUndefined();
    expect(parseFields(' , ')).toBeUndefined();
  });
  it('loại không hợp lệ => 422 kèm tên giá trị', () => {
    const err = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e as { status: number; message: string };
      }
      throw new Error('không ném lỗi');
    };
    const a = err(() => parseFields('STATUS,NOPE'));
    expect(a.status).toBe(422);
    expect(a.message).toBe('Loại thay đổi không hợp lệ: NOPE');
    expect(err(() => parseFields(['STATUS', 'bad'])).status).toBe(422);
  });
  it('nhận loại COMPONENT/FIX_VERSION', () => {
    expect(parseFields('COMPONENT,FIX_VERSION')).toEqual(['COMPONENT', 'FIX_VERSION']);
  });
});
