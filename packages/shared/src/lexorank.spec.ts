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
  it('property: 10k cặp ngẫu nhiên (RNG có seed) — RankGapError chỉ khi next = prev + số 0 hoặc prev >= next', () => {
    // LCG (Numerical Recipes) để lỗi tái hiện được: cùng seed → cùng dãy cặp.
    let state = 20261016;
    const rand = (n: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 0x100000000) * n);
    };
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    const rnd = () =>
      Array.from({ length: 1 + rand(6) }, () => chars[rand(36)])
        .join('')
        .replace(/0+$/, '') || '1';
    let gaps = 0;
    for (let i = 0; i < 10000; i++) {
      const x = rnd();
      const y = rnd();
      if (x === y) continue;
      const [a, b] = x < y ? [x, y] : [y, x];

      // a < b hợp lệ (không có số 0 đuôi): luôn phải có rank nằm giữa.
      const r = rankBetween(a, b);
      expect(r > a && r < b).toBe(true);
      expect(r.endsWith('0')).toBe(false);

      // prev >= next: luôn là RankGapError.
      expect(() => rankBetween(b, a)).toThrow(RankGapError);

      // next = prev + số 0 (cùng giá trị thập phân): luôn là RankGapError.
      expect(() => rankBetween(a, a + '0'.repeat(1 + rand(3)))).toThrow(RankGapError);
      gaps++;
    }
    expect(gaps).toBeGreaterThan(9000);
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
    for (const [a, b] of [
      ['n', 'n01'],
      ['n', 'n0001'],
      ['n0', 'n1'],
      ['', '01'],
      ['zz', ''],
      ['', '0001'],
    ] as const) {
      const r = rankBetween(a || null, b || null);
      expect(r > a && (b === '' || r < b)).toBe(true);
      expect(r.endsWith('0')).toBe(false);
    }
  });
  it('a >= b ném lỗi thay vì trả rank sai', () => {
    expect(() => rankBetween('n', 'n')).toThrow(RankGapError);
  });
});
