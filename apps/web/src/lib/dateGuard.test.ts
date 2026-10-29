import { describe, expect, it } from 'vitest';
import { firstInvalid } from './dateGuard';

const el = (name: string, customError: boolean) => ({ name, validity: { customError } });

describe('firstInvalid', () => {
  it('không ô nào lỗi → undefined (cho lưu)', () => {
    expect(firstInvalid([el('a', false), el('b', false)])).toBeUndefined();
    expect(firstInvalid([])).toBeUndefined();
  });
  it('trả ô lỗi đầu tiên theo thứ tự trong form', () => {
    expect(firstInvalid([el('a', false), el('b', true), el('c', true)])?.name).toBe('b');
  });
});
