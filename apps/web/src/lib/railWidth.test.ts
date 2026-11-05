// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  clampRailWidth,
  parseRailWidth,
  railWidthForKey,
  railWidthKey,
  useRailWidth,
} from './railWidth';

describe('độ rộng danh sách dự án', () => {
  it('kẹp trong khoảng cho phép', () => {
    expect(clampRailWidth(100)).toBe(RAIL_WIDTH_MIN);
    expect(clampRailWidth(9999)).toBe(RAIL_WIDTH_MAX);
    expect(clampRailWidth(300.4)).toBe(300);
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_WIDTH_DEFAULT);
  });
  it('giá trị đã lưu hỏng/thiếu → mặc định', () => {
    expect(parseRailWidth(null)).toBe(RAIL_WIDTH_DEFAULT);
    expect(parseRailWidth('abc')).toBe(RAIL_WIDTH_DEFAULT);
    expect(parseRailWidth('')).toBe(RAIL_WIDTH_DEFAULT);
    expect(parseRailWidth('360')).toBe(360);
    expect(parseRailWidth('5000')).toBe(RAIL_WIDTH_MAX);
  });
  it('phím trên tay nắm', () => {
    expect(railWidthForKey(300, 'ArrowRight', false)).toBe(316);
    expect(railWidthForKey(300, 'ArrowLeft', true)).toBe(236);
    expect(railWidthForKey(300, 'Home', false)).toBe(RAIL_WIDTH_MIN);
    expect(railWidthForKey(300, 'End', false)).toBe(RAIL_WIDTH_MAX);
    expect(railWidthForKey(300, 'Enter', false)).toBe(RAIL_WIDTH_DEFAULT);
    expect(railWidthForKey(300, 'a', false)).toBeNull();
  });
  it('nhớ theo người dùng; kéo rồi thả thì lưu', () => {
    localStorage.setItem(railWidthKey('u1'), '320');
    const { result } = renderHook(() => useRailWidth('u1'));
    expect(result.current.width).toBe(320);
    const target = { setPointerCapture: () => {} };
    act(() =>
      result.current.handleProps.onPointerDown({
        button: 0,
        clientX: 100,
        pointerId: 1,
        preventDefault: () => {},
        currentTarget: target,
      } as never),
    );
    expect(result.current.dragging).toBe(true);
    act(() => result.current.handleProps.onPointerMove({ clientX: 180, buttons: 1 } as never));
    expect(result.current.width).toBe(400);
    act(() => result.current.handleProps.onPointerUp({ clientX: 180 } as never));
    expect(result.current.dragging).toBe(false);
    expect(localStorage.getItem(railWidthKey('u1'))).toBe('400');
    act(() => result.current.handleProps.onDoubleClick());
    expect(localStorage.getItem(railWidthKey('u1'))).toBe(String(RAIL_WIDTH_DEFAULT));
  });
  it('huỷ kéo thì trả về độ rộng cũ, không lưu', () => {
    localStorage.setItem(railWidthKey('u2'), '300');
    const { result } = renderHook(() => useRailWidth('u2'));
    act(() =>
      result.current.handleProps.onPointerDown({
        button: 0,
        clientX: 0,
        pointerId: 1,
        preventDefault: () => {},
        currentTarget: {},
      } as never),
    );
    act(() => result.current.handleProps.onPointerMove({ clientX: 100, buttons: 1 } as never));
    expect(result.current.width).toBe(400);
    act(() => result.current.handleProps.onPointerMove({ clientX: 150, buttons: 0 } as never));
    expect(result.current.width).toBe(400);
    act(() => result.current.handleProps.onPointerCancel());
    expect(result.current.width).toBe(300);
    expect(result.current.dragging).toBe(false);
    expect(localStorage.getItem(railWidthKey('u2'))).toBe('300');
  });
});
