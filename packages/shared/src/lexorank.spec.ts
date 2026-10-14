import { describe, expect, it } from 'vitest';
import { RankGapError, initialRanks, rankBetween } from './lexorank';

describe('rankBetween', () => {
  it('đưa lên đầu 50 lần vẫn giữ thứ tự', () => {
    let top = 'n';
    const seen = [top];
    for (let i = 0; i < 50; i++) {
      top = rankBetween(null, top);
      seen.push(top);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]! < seen[i - 1]!).toBe(true);
  });
  it('thêm cuối 500 lần vẫn tăng và không dài quá 48', () => {
    let last: string | null = null;
    let prev = '';
    for (let i = 0; i < 500; i++) {
      last = rankBetween(last, null);
      expect(last > prev).toBe(true);
      expect(last.length).toBeLessThanOrEqual(48);
      prev = last;
    }
  });
  it('chèn giữa cặp sát nhau', () => {
    expect(() => rankBetween('n', 'n0')).toThrow(RankGapError);
    const r = rankBetween('n', 'n1');
    expect(r > 'n' && r < 'n1').toBe(true);
  });
  it('property: 10k cặp ngẫu nhiên', () => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    const rnd = () =>
      Array.from({ length: 1 + Math.floor(Math.random() * 6) }, () => chars[Math.floor(Math.random() * 36)])
        .join('')
        .replace(/0+$/, '') || '1';
    for (let i = 0; i < 10000; i++) {
      let a = rnd();
      let b = rnd();
      if (a === b) continue;
      if (a > b) [a, b] = [b, a];
      try {
        const r = rankBetween(a, b);
        expect(r > a && r < b).toBe(true);
        expect(r.endsWith('0')).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(RankGapError);
      }
    }
  });
  it('initialRanks cách đều và tăng dần', () => {
    const rs = initialRanks(10);
    for (let i = 1; i < rs.length; i++) expect(rs[i]! > rs[i - 1]!).toBe(true);
  });
  it('initialRanks lớn (5000) vẫn tăng chặt và không kết thúc bằng 0', () => {
    const rs = initialRanks(5000);
    for (let i = 0; i < rs.length; i++) {
      expect(rs[i]!.endsWith('0')).toBe(false);
      if (i > 0) expect(rs[i]! > rs[i - 1]!).toBe(true);
    }
  });
  it('chèn giữa khi a là tiền tố của b có số 0 xen kẽ', () => {
    for (const [a, b] of [['n', 'n01'], ['n', 'n0001'], ['n0', 'n1'], ['', '01'], ['zz', ''], ['', '0001']] as const) {
      const r = rankBetween(a || null, b || null);
      expect(r > a && (b === '' || r < b)).toBe(true);
      expect(r.endsWith('0')).toBe(false);
    }
  });
  it('a >= b ném lỗi thay vì trả rank sai', () => {
    expect(() => rankBetween('n', 'n')).toThrow(RankGapError);
  });
});
