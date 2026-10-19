import { describe, expect, it } from 'vitest';
import { matchesConfirmText, normalizeConfirmText } from './confirmText';

describe('normalizeConfirmText', () => {
  it('cắt khoảng trắng hai đầu và gộp khoảng trắng giữa chữ', () => {
    expect(normalizeConfirmText('  Khoá   tích\thợp \n CI ')).toBe('Khoá tích hợp CI');
  });
  it('đưa về NFC để dấu tiếng Việt gõ rời vẫn khớp', () => {
    const decomposed = 'Tiến'; // e + mũ + sắc
    expect(normalizeConfirmText(decomposed)).toBe(normalizeConfirmText('Tiến'));
  });
});

describe('matchesConfirmText', () => {
  it('khớp khi giống hệt', () => {
    expect(matchesConfirmText('CI deploy', 'CI deploy')).toBe(true);
  });
  it('khớp dù thừa/thiếu khoảng trắng', () => {
    expect(matchesConfirmText('  CI   deploy ', 'CI deploy')).toBe(true);
    expect(matchesConfirmText('CI deploy', ' CI  deploy  ')).toBe(true);
  });
  it('phân biệt hoa/thường', () => {
    expect(matchesConfirmText('ci deploy', 'CI deploy')).toBe(false);
  });
  it('phân biệt dấu', () => {
    expect(matchesConfirmText('Khoa', 'Khoá')).toBe(false);
  });
  it('chưa gõ hoặc gõ thiếu → không khớp', () => {
    expect(matchesConfirmText('', 'CI deploy')).toBe(false);
    expect(matchesConfirmText('CI', 'CI deploy')).toBe(false);
  });
  it('không có gì để gõ (tên rỗng) → không khớp, tránh mở cửa sau', () => {
    expect(matchesConfirmText('', '')).toBe(false);
    expect(matchesConfirmText('   ', '  ')).toBe(false);
  });
});
