import { describe, expect, it } from 'vitest';
import { goalWords, matchedGoalWords } from './sprint-goal-match';

describe('goalWords', () => {
  it('bỏ từ dừng và từ quá ngắn, giữ chữ có dấu để hiển thị', () => {
    expect(goalWords('Hoàn thiện luồng thanh toán').map((w) => w.raw)).toEqual([
      'luồng',
      'thanh',
      'toán',
    ]);
  });
  it('rỗng → []', () => expect(goalWords('  ')).toEqual([]));
});
describe('matchedGoalWords', () => {
  const words = goalWords('giữ giỏ hàng');
  it('khớp không dấu, trả từ gốc', () => {
    expect(matchedGoalWords(words, 'Giỏ hàng: thêm/xóa sản phẩm')).toEqual(['giỏ', 'hàng']);
    expect(matchedGoalWords(words, 'gio hang bi mat')).toEqual(['giỏ', 'hàng']);
  });
  it('không khớp → []', () => expect(matchedGoalWords(words, 'Thanh toán qua VNPay')).toEqual([]));
  it('khớp đầu từ, không khớp giữa từ ("hàng" không khớp "tháng")', () => {
    expect(matchedGoalWords(goalWords('hàng'), 'Báo cáo tháng')).toEqual([]);
  });
});
