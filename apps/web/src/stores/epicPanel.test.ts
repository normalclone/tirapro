import { describe, expect, it } from 'vitest';
import { epicPanelShown } from './epicPanel';

describe('epicPanelShown (WC-I3)', () => {
  it('xem nhanh mở ở khổ hẹp → panel Epic thu tạm', () =>
    expect(epicPanelShown(true, true, true)).toBe(false));
  it('đóng xem nhanh → trả về trạng thái người dùng đã chọn', () => {
    expect(epicPanelShown(true, false, true)).toBe(true);
    expect(epicPanelShown(false, false, true)).toBe(false);
  });
  it('khổ rộng (≥ 2xl) giữ cả hai', () => expect(epicPanelShown(true, true, false)).toBe(true));
  it('người dùng đã đóng Epic thì xem nhanh không mở lại nó', () =>
    expect(epicPanelShown(false, true, true)).toBe(false));
});
