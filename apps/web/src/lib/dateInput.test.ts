import { describe, expect, it } from 'vitest';
import {
  formatViDate,
  joinDateTime,
  maskViDate,
  maskViTime,
  parseViDate,
  parseViTime,
  splitDateTime,
} from './dateInput';

describe('maskViDate', () => {
  it('tự chèn dấu /', () => {
    expect(maskViDate('0508')).toBe('05/08');
    expect(maskViDate('05082026')).toBe('05/08/2026');
    expect(maskViDate('05/08/20269999')).toBe('05/08/2026');
    expect(maskViDate('ab12')).toBe('12');
  });
  it('gõ tay dấu phân cách chốt phần ngày/tháng 1 chữ số (đệm 0)', () => {
    expect(maskViDate('5/')).toBe('05/');
    expect(maskViDate('5/8/2026')).toBe('05/08/2026');
    expect(maskViDate('5.8.26')).toBe('05/08/26');
    expect(maskViDate('05/8/')).toBe('05/08/');
    expect(maskViDate('5/8')).toBe('05/8');
  });
  it('gõ liền từng chữ số vẫn đúng khi có dấu / tự chèn', () => {
    expect(maskViDate('05/082')).toBe('05/08/2');
    expect(maskViDate('05/0')).toBe('05/0');
  });
});
describe('parseViDate', () => {
  it('chấp nhận nhiều dạng, trả ISO', () => {
    expect(parseViDate('05/08/2026')).toBe('2026-08-05');
    expect(parseViDate('5/8/2026')).toBe('2026-08-05');
    expect(parseViDate('5-8-26')).toBe('2026-08-05');
    expect(parseViDate('5.8.2026')).toBe('2026-08-05');
  });
  it('từ chối ngày không có thật / ngoài khoảng', () => {
    expect(parseViDate('31/02/2026')).toBeNull();
    expect(parseViDate('00/01/2026')).toBeNull();
    expect(parseViDate('01/13/2026')).toBeNull();
    expect(parseViDate('01/01/1800')).toBeNull();
    expect(parseViDate('05/08')).toBeNull();
    expect(parseViDate('')).toBeNull();
  });
  it('29/02 chỉ hợp lệ năm nhuận', () => {
    expect(parseViDate('29/02/2028')).toBe('2028-02-29');
    expect(parseViDate('29/02/2027')).toBeNull();
  });
});
describe('formatViDate', () => {
  it('ISO → dd/MM/yyyy không qua múi giờ', () => {
    expect(formatViDate('2026-08-05')).toBe('05/08/2026');
    expect(formatViDate('')).toBe('');
    expect(formatViDate('rác')).toBe('');
  });
});
describe('giờ', () => {
  it('mặt nạ + parse HH:mm 24h', () => {
    expect(maskViTime('0930')).toBe('09:30');
    expect(maskViTime('9:30')).toBe('09:30');
    expect(maskViTime('9:')).toBe('09:');
    expect(maskViTime('09:3')).toBe('09:3');
    expect(parseViTime('9:30')).toBe('09:30');
    expect(parseViTime('24:00')).toBeNull();
    expect(parseViTime('12:60')).toBeNull();
  });
  it('ghép / tách', () => {
    expect(joinDateTime('2026-08-05', '09:30')).toBe('2026-08-05T09:30');
    expect(joinDateTime('', '09:30')).toBe('');
    expect(splitDateTime('2026-08-05T09:30')).toEqual({ date: '2026-08-05', time: '09:30' });
    expect(splitDateTime('')).toEqual({ date: '', time: '' });
  });
});
