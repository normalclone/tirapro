import { describe, expect, it } from 'vitest';
import { PositiveInt32Pipe } from './positive-int32.pipe';

describe('PositiveInt32Pipe', () => {
  const pipe = new PositiveInt32Pipe();
  it('nhận số nguyên 1..2^31-1', () => {
    expect(pipe.transform('1')).toBe(1);
    expect(pipe.transform('2147483647')).toBe(2147483647);
  });
  it.each(['0', '-1', '1.5', 'abc', '', '2147483648', '99999999999', '1e3'])('"%s" → 400', (v) => {
    expect(() => pipe.transform(v)).toThrow(expect.objectContaining({ status: 400 }) as Error);
  });
});
