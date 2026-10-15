import { describe, expect, it } from 'vitest';
import { filenameFromDisposition } from './download';

describe('filenameFromDisposition', () => {
  it('đọc filename*=UTF-8 và filename thường, rơi về fallback', () => {
    expect(
      filenameFromDisposition(`attachment; filename*=UTF-8''b%C3%A1o-c%C3%A1o.csv`, 'x.csv'),
    ).toBe('báo-cáo.csv');
    expect(filenameFromDisposition('attachment; filename="a.csv"', 'x.csv')).toBe('a.csv');
    expect(filenameFromDisposition('', 'x.csv')).toBe('x.csv');
  });
});
