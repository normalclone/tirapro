import { describe, expect, it } from 'vitest';
import { errorFlowReducer, type ErrorFlowState } from './useErrorFlow';

const init: ErrorFlowState = { attempted: false, attempts: 0 };

describe('errorFlowReducer', () => {
  it('fail() bật hiển thị và tăng số lần thử mỗi lần gọi', () => {
    const a = errorFlowReducer(init, 'fail');
    expect(a).toEqual({ attempted: true, attempts: 1 });
    expect(errorFlowReducer(a, 'fail')).toEqual({ attempted: true, attempts: 2 });
  });
  it('reset() tắt hiển thị nhưng KHÔNG đổi số lần thử (không phát thông báo)', () => {
    const a = errorFlowReducer(errorFlowReducer(init, 'fail'), 'reset');
    expect(a).toEqual({ attempted: false, attempts: 1 });
  });
  it('số lần thử chỉ tăng ở fail(): reset không làm nó nhảy', () => {
    let s = init;
    for (const act of ['reset', 'reset', 'fail', 'reset', 'fail'] as const)
      s = errorFlowReducer(s, act);
    expect(s.attempts).toBe(2);
  });
});
