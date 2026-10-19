import { describe, expect, it } from 'vitest';
import { closestMatch } from './did-you-mean';

const statuses = ['To Do', 'In Progress', 'In Review', 'Done'];
describe('closestMatch', () => {
  it('gõ sai nhẹ → gợi ý đúng', () => {
    expect(closestMatch('In Progresss', statuses)).toBe('In Progress');
    expect(closestMatch('in progres', statuses)).toBe('In Progress');
  });
  it('không dấu / hoa thường vẫn khớp', () =>
    expect(closestMatch('thanh toan', ['Thanh toán', 'Tìm kiếm'])).toBe('Thanh toán'));
  it('quá xa → null', () => expect(closestMatch('zzzzzz', statuses)).toBeNull());
  it('khớp tuyệt đối (không phân biệt hoa thường) → chính nó', () =>
    expect(closestMatch('DONE', statuses)).toBe('Done'));
});
