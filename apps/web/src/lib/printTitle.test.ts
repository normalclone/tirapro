import { describe, expect, it } from 'vitest';
import { printTitle } from './printTitle';

describe('printTitle', () => {
  it('thêm ngày dd-MM-yyyy và bỏ ký tự cấm tên file', () => {
    expect(printTitle('Báo cáo Sprint 2: DEMO/Core', new Date(2026, 9, 15))).toBe(
      'Báo cáo Sprint 2 DEMOCore — 15-10-2026',
    );
  });

  it('Tổng quan — 15-10-2026; bỏ hết ký tự cấm kể cả \\ * ? " < > |', () => {
    expect(printTitle('Tổng quan', new Date(2026, 9, 15))).toBe('Tổng quan — 15-10-2026');
    expect(printTitle('a\\b*c?d"e<f>g|h', new Date(2026, 0, 5))).toBe('abcdefgh — 05-01-2026');
  });

  it('tên rỗng sau khi làm sạch → "Tirapro"', () => {
    expect(printTitle('///', new Date(2026, 9, 15))).toBe('Tirapro — 15-10-2026');
  });
});
