import { describe, expect, it } from 'vitest';
import { shouldSuppressContextMenu } from './contextGuard';

describe('shouldSuppressContextMenu — nhấn giữ cảm ứng/bút trên máy lai không được mở menu', () => {
  it('cử chỉ cuối là cảm ứng hoặc bút → chặn contextmenu theo sau', () => {
    expect(shouldSuppressContextMenu('touch')).toBe(true);
    expect(shouldSuppressContextMenu('pen')).toBe(true);
  });
  it('chuột, bàn phím (Shift+F10/phím Menu) hoặc chưa có cử chỉ → cho mở', () => {
    expect(shouldSuppressContextMenu('mouse')).toBe(false);
    expect(shouldSuppressContextMenu('keyboard')).toBe(false);
    expect(shouldSuppressContextMenu(null)).toBe(false);
    expect(shouldSuppressContextMenu('')).toBe(false);
  });
});
