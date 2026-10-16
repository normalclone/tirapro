import { describe, expect, it } from 'vitest';
import {
  applyDrag,
  buildUnscheduledPatch,
  clampDelta,
  keyToDrag,
  orderSpans,
  pxToDays,
  resizeSpan,
  shiftSpan,
  toIssuePatch,
} from './dragMath';

const d = (s: string) => new Date(`${s}T00:00:00`);
const span = { start: d('2026-10-15'), end: d('2026-10-17') };

describe('dragMath', () => {
  it('shiftSpan dời cả hai đầu', () => {
    expect(shiftSpan(span, 3)).toEqual({ start: d('2026-10-18'), end: d('2026-10-20') });
    expect(shiftSpan(span, -2)).toEqual({ start: d('2026-10-13'), end: d('2026-10-15') });
  });

  it('resizeSpan: kéo mép phải về trước start bị kẹp (tối thiểu 1 ngày), mép trái vượt end bị kẹp', () => {
    expect(resizeSpan(span, 'end', -5).end).toEqual(d('2026-10-15'));
    expect(resizeSpan(span, 'start', 9).start).toEqual(d('2026-10-17'));
    expect(resizeSpan(span, 'end', 2)).toEqual({ start: d('2026-10-15'), end: d('2026-10-19') });
    expect(resizeSpan(span, 'start', -1)).toEqual({ start: d('2026-10-14'), end: d('2026-10-17') });
  });

  it('applyDrag: thân = dời, mép = co giãn', () => {
    expect(applyDrag(span, 'move', 1)).toEqual(shiftSpan(span, 1));
    expect(applyDrag(span, 'end', 1)).toEqual(resizeSpan(span, 'end', 1));
    expect(applyDrag(span, 'start', 1)).toEqual(resizeSpan(span, 'start', 1));
  });

  it('pxToDays làm tròn theo DAY_W', () => {
    expect(pxToDays(30, 28)).toBe(1);
    expect(pxToDays(13, 28)).toBe(0);
    expect(pxToDays(-43, 28)).toBe(-2);
    expect(Object.is(pxToDays(-5, 28), 0)).toBe(true);
  });
});

describe('toIssuePatch', () => {
  it('giữ giờ của hạn cũ khi dời; chỉ gửi đầu đổi ngày', () => {
    const due = new Date(2026, 9, 17, 17, 30).toISOString();
    const start = new Date(2026, 9, 15, 9, 0).toISOString();
    const patch = toIssuePatch({ startDate: start, dueDate: due }, shiftSpan(span, 2));
    expect(patch.dueDate).toBe(new Date(2026, 9, 19, 17, 30).toISOString());
    expect(patch.startDate).toBe(new Date(2026, 9, 17, 9, 0).toISOString());
  });

  it('co giãn mép phải chỉ gửi dueDate', () => {
    const due = new Date(2026, 9, 17, 17, 0).toISOString();
    const start = new Date(2026, 9, 15, 0, 0).toISOString();
    const patch = toIssuePatch({ startDate: start, dueDate: due }, resizeSpan(span, 'end', -1));
    expect(Object.keys(patch)).toEqual(['dueDate']);
    expect(patch.dueDate).toBe(new Date(2026, 9, 16, 17, 0).toISOString());
  });

  it('việc chưa có ngày: bắt đầu 00:00, hạn 23:59 địa phương, cả hai đầu', () => {
    const patch = toIssuePatch({ startDate: null, dueDate: null }, shiftSpan(span, 1), span);
    expect(patch.startDate).toBe(new Date(2026, 9, 16, 0, 0).toISOString());
    expect(patch.dueDate).toBe(new Date(2026, 9, 18, 23, 59).toISOString());
  });

  it('chỉ có hạn (thanh 1 ngày): kéo mép phải → bắt đầu cũng thành ngày thật', () => {
    const due = new Date(2026, 9, 17, 17, 0).toISOString();
    const one = { start: d('2026-10-17'), end: d('2026-10-17') };
    const patch = toIssuePatch({ startDate: null, dueDate: due }, resizeSpan(one, 'end', 2), one);
    expect(patch.startDate).toBe(new Date(2026, 9, 17, 0, 0).toISOString());
    expect(patch.dueDate).toBe(new Date(2026, 9, 19, 17, 0).toISOString());
  });

  it('cùng ngày mà giờ bắt đầu cũ muộn hơn giờ hạn → hạ bắt đầu về 00:00', () => {
    const start = new Date(2026, 9, 15, 14, 0).toISOString();
    const due = new Date(2026, 9, 17, 9, 0).toISOString();
    const patch = toIssuePatch(
      { startDate: start, dueDate: due },
      resizeSpan(span, 'start', 5), // kẹp start = end = 17/10
    );
    expect(patch.startDate).toBe(new Date(2026, 9, 17, 0, 0).toISOString());
    expect(patch.dueDate).toBeUndefined();
  });
});

describe('buildUnscheduledPatch', () => {
  it('cả hai ô trống → không có gì để lưu', () => {
    expect(buildUnscheduledPatch('', '')).toBeNull();
  });
  it('đủ hai đầu: bắt đầu 00:00, hạn 23:59 giờ địa phương', () => {
    expect(buildUnscheduledPatch('2026-10-16', '2026-10-20')).toEqual({
      startDate: new Date(2026, 9, 16, 0, 0).toISOString(),
      dueDate: new Date(2026, 9, 20, 23, 59).toISOString(),
    });
  });
  it('trống một đầu = chỉ đặt đầu còn lại', () => {
    expect(buildUnscheduledPatch('', '2026-10-20')).toEqual({
      dueDate: new Date(2026, 9, 20, 23, 59).toISOString(),
    });
    expect(buildUnscheduledPatch('2026-10-16', '')).toEqual({
      startDate: new Date(2026, 9, 16, 0, 0).toISOString(),
    });
  });
});

describe('clampDelta — giữ thanh trong thước thời gian', () => {
  // thanh chiếm ngày 3..5 trên thước 0..9
  it('dời: không vượt hai đầu thước', () => {
    expect(clampDelta(3, 5, 9, 'move', -10)).toBe(-3);
    expect(clampDelta(3, 5, 9, 'move', 10)).toBe(4);
    expect(clampDelta(3, 5, 9, 'move', 2)).toBe(2);
  });
  it('mép trái: không qua đầu thước và không vượt mép phải; mép phải: không dưới mép trái và không qua cuối thước', () => {
    expect(clampDelta(3, 5, 9, 'start', -9)).toBe(-3);
    expect(clampDelta(3, 5, 9, 'start', 9)).toBe(2);
    expect(clampDelta(3, 5, 9, 'end', -9)).toBe(-2);
    expect(clampDelta(3, 5, 9, 'end', 9)).toBe(4);
  });
  it('cộng dồn phím: kẹp theo tổng số ngày đã bấm (giữ phím không chạy ra ngoài thước)', () => {
    let acc = 0;
    for (let i = 0; i < 10; i++) acc = clampDelta(3, 5, 9, 'move', acc + 1);
    expect(acc).toBe(4);
  });
});

describe('keyToDrag — phím mũi tên trên thanh', () => {
  const k = (key: string, shiftKey = false, altKey = false) => ({ key, shiftKey, altKey });
  it('Shift = dời cả thanh, Alt = đổi hạn, Alt+Shift = đổi bắt đầu', () => {
    expect(keyToDrag(k('ArrowRight', true))).toEqual({ mode: 'move', dir: 1 });
    expect(keyToDrag(k('ArrowLeft', true))).toEqual({ mode: 'move', dir: -1 });
    expect(keyToDrag(k('ArrowRight', false, true))).toEqual({ mode: 'end', dir: 1 });
    expect(keyToDrag(k('ArrowLeft', true, true))).toEqual({ mode: 'start', dir: -1 });
  });
  it('mũi tên trần hoặc phím khác → null (không cướp phím của trang)', () => {
    expect(keyToDrag(k('ArrowRight'))).toBeNull();
    expect(keyToDrag(k('ArrowUp', true))).toBeNull();
    expect(keyToDrag(k('a', true))).toBeNull();
  });
});

describe('orderSpans — thứ tự hàng ổn định sau khi thả', () => {
  const s = (id: string, start: string, end = start) => ({ id, start: d(start), end: d(end) });
  const a = s('a', '2026-10-10');
  const b = s('b', '2026-10-12');
  const c = s('c', '2026-10-14');
  it('không đóng băng: sắp theo ngày bắt đầu rồi kết thúc', () => {
    expect(orderSpans([c, a, b], null).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('đóng băng: thanh vừa kéo sang ngày muộn vẫn ở hàng cũ', () => {
    const moved = s('a', '2026-10-20');
    expect(orderSpans([moved, b, c], ['a', 'b', 'c']).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('việc mới (chưa có trong danh sách đóng băng) xếp sau, theo ngày', () => {
    const n1 = s('n1', '2026-10-13');
    const n0 = s('n0', '2026-10-01');
    expect(orderSpans([n1, n0, c, a, b], ['a', 'b', 'c']).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
      'n0',
      'n1',
    ]);
  });
});
