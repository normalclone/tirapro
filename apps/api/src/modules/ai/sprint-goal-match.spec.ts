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
  it('chuỗi NFD (dán từ macOS) vẫn tách đúng từ và giữ dấu khi hiển thị', () => {
    const nfd = 'giữ giỏ hàng'.normalize('NFD');
    expect(goalWords(nfd).map((w) => w.raw)).toEqual(
      ['giữ', 'giỏ', 'hàng'].map((x) => x.normalize('NFC')),
    );
    expect(matchedGoalWords(goalWords(nfd), 'Giỏ hàng'.normalize('NFD'))).toEqual(['giỏ', 'hàng']);
  });
  it('khớp có dấu ưu tiên: "bán" không khớp "bản" (cả hai có dấu khác nhau)', () => {
    expect(matchedGoalWords(goalWords('bán hàng'), 'Bản nháp hợp đồng')).toEqual([]);
    expect(matchedGoalWords(goalWords('bán hàng'), 'Bán hàng online')).toEqual(['bán', 'hàng']);
  });
  it('gõ không dấu một bên vẫn khớp', () => {
    expect(matchedGoalWords(goalWords('ban hang'), 'Bán hàng online')).toEqual(['ban', 'hang']);
    expect(matchedGoalWords(goalWords('bán hàng'), 'ban hang online')).toEqual(['bán', 'hàng']);
  });
});
