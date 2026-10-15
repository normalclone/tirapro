import { describe, expect, it } from 'vitest';
import { normalizeVi, searchTokens, VI_TRANSLATE_FROM, VI_TRANSLATE_TO } from './vi-text';

describe('normalizeVi', () => {
  it('bỏ dấu tiếng Việt, đ/Đ → d, hạ chữ thường', () => {
    expect(normalizeVi('Thanh toán đơn hàng')).toBe('thanh toan don hang');
    expect(normalizeVi('ĐƯỜNG Đồng ý')).toBe('duong dong y');
    expect(normalizeVi('DEMO-TASK-37')).toBe('demo-task-37');
  });
});

describe('searchTokens', () => {
  it('chỉ chữ/số Unicode, giữ dấu (SQL bỏ dấu sau), tối đa 8 token, mỗi token ≤ 40 ký tự', () => {
    expect(searchTokens("số 37, cho!  (a|b) 'x'")).toEqual(['số', '37', 'cho', 'a', 'b', 'x']);
    expect(searchTokens('a b c d e f g h i j')).toHaveLength(8);
    expect(searchTokens('x'.repeat(100))[0]).toHaveLength(40);
    expect(searchTokens('!!! ---')).toEqual([]);
  });
});

describe('searchTokens — ký tự mà unaccent đổi thành dấu nháy/hai chấm/ngoặc (to_tsquery 42601)', () => {
  it('bỏ ký tự modifier (ʼ ʹ ʻ ʽ ˈ ː) và số khoanh ⑴ — không để lọt dấu đặc biệt của tsquery', () => {
    expect(searchTokens('ʼ')).toEqual([]);
    expect(searchTokens('ː ˈ ʹ ʻ ʽ')).toEqual([]);
    expect(searchTokens('⑴')).toEqual(['1']);
    expect(searchTokens('⒇ abc')).toEqual(['20', 'abc']);
    expect(searchTokens('ŉ')).toEqual(['n']);
    expect(searchTokens('thanhʼ toán')).toEqual(['thanh', 'toán']);
    for (const t of searchTokens("ʼ ⑴ ŉ ː a:b x'y")) expect(t).toMatch(/^[\p{L}\p{N}]+$/u);
  });
  it('chuẩn hoá NFC: chuỗi NFD (macOS) cho cùng token với NFC', () => {
    const nfd = 'thanh toán số'.normalize('NFD');
    expect(searchTokens(nfd)).toEqual(['thanh', 'toán', 'số']);
    expect(searchTokens(nfd)).toEqual(searchTokens('thanh toán số'.normalize('NFC')));
  });
});

describe('bảng translate cho fallback', () => {
  it('FROM và TO cùng độ dài, ánh xạ về chữ cái không dấu', () => {
    expect([...VI_TRANSLATE_FROM]).toHaveLength([...VI_TRANSLATE_TO].length);
    const map = new Map([...VI_TRANSLATE_FROM].map((c, i) => [c, [...VI_TRANSLATE_TO][i]]));
    expect(map.get('ố')).toBe('o');
    expect(map.get('Đ')).toBe('D');
    expect(map.get('ữ')).toBe('u');
  });
});
