import { describe, expect, it } from 'vitest';
import { selectGesture } from './selectGesture';

const e = (o: Partial<Parameters<typeof selectGesture>[0]> = {}) => ({
  button: 0,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...o,
});

describe('selectGesture (click trên thẻ có phím bổ trợ)', () => {
  it('click thường → null (vẫn mở xem nhanh, chọn không giành click)', () => {
    expect(selectGesture(e(), false)).toBeNull();
  });
  it('Shift+click → chọn dải, kể cả khi bấm vào link mã (tránh mở cửa sổ mới)', () => {
    expect(selectGesture(e({ shiftKey: true }), false)).toBe('range');
    expect(selectGesture(e({ shiftKey: true }), true)).toBe('range');
  });
  it('Cmd/Ctrl+click trên thẻ → bật/tắt thẻ; trên link mã → giữ hành vi tab mới', () => {
    expect(selectGesture(e({ metaKey: true }), false)).toBe('toggle');
    expect(selectGesture(e({ ctrlKey: true }), false)).toBe('toggle');
    expect(selectGesture(e({ metaKey: true }), true)).toBeNull();
  });
  it('Alt, chuột giữa/phải → không phải cử chỉ chọn', () => {
    expect(selectGesture(e({ altKey: true, shiftKey: true }), false)).toBeNull();
    expect(selectGesture(e({ button: 1, shiftKey: true }), false)).toBeNull();
    expect(selectGesture(e({ button: 2, metaKey: true }), false)).toBeNull();
  });
});
