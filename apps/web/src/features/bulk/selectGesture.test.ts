import { describe, expect, it } from 'vitest';
import { handleShiftRangeClick, selectGesture } from './selectGesture';

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

describe('handleShiftRangeClick (Shift+click trên dòng Bộ lọc, pha bắt)', () => {
  const mkEvent = (o: {
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    button?: number;
    inside?: boolean;
    interactive?: boolean;
  }) => {
    const calls = { prevent: 0, stop: 0 };
    return {
      calls,
      e: {
        button: o.button ?? 0,
        shiftKey: o.shiftKey ?? false,
        metaKey: o.metaKey ?? false,
        ctrlKey: o.ctrlKey ?? false,
        altKey: false,
        target: { closest: () => (o.interactive ? {} : null) },
        currentTarget: { contains: () => o.inside ?? true },
        preventDefault: () => void calls.prevent++,
        stopPropagation: () => void calls.stop++,
      },
    };
  };
  it('Shift+click trên thân dòng / link mã → chọn dải, chặn mặc định (bôi đen chữ, cửa sổ mới) và không lan lên xem nhanh', () => {
    let ranged = 0;
    const { e, calls } = mkEvent({ shiftKey: true });
    expect(handleShiftRangeClick(e, () => void ranged++)).toBe(true);
    expect(ranged).toBe(1);
    expect(calls).toEqual({ prevent: 1, stop: 1 });
  });
  it('Cmd/Ctrl+click vẫn để dòng mở tab mới; click thường vẫn mở xem nhanh', () => {
    for (const o of [{ metaKey: true }, { ctrlKey: true }, {}]) {
      let ranged = 0;
      const { e, calls } = mkEvent(o);
      expect(handleShiftRangeClick(e, () => void ranged++)).toBe(false);
      expect(ranged).toBe(0);
      expect(calls).toEqual({ prevent: 0, stop: 0 });
    }
  });
  it('bỏ qua ô chọn/nút (tự xử lý) và sự kiện từ portal (ngoài dòng)', () => {
    let ranged = 0;
    expect(
      handleShiftRangeClick(mkEvent({ shiftKey: true, interactive: true }).e, () => void ranged++),
    ).toBe(false);
    expect(
      handleShiftRangeClick(mkEvent({ shiftKey: true, inside: false }).e, () => void ranged++),
    ).toBe(false);
    expect(ranged).toBe(0);
  });
});
