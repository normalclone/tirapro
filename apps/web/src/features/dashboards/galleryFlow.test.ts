import { describe, expect, it } from 'vitest';
import { BLANK_TEMPLATE_KEY, blankNeedsNoScope, landingUrl } from './galleryFlow';

describe('galleryFlow', () => {
  it('khoá mẫu Trống khớp mẫu của shared', async () => {
    const { findDashboardTemplate } = await import('@tirapro/shared');
    expect(findDashboardTemplate(BLANK_TEMPLATE_KEY)?.widgets).toHaveLength(0);
  });
  it('chỉ mẫu Trống được tạo khi chưa chọn đích phạm vi', () => {
    expect(blankNeedsNoScope('blank', 'Chọn dự án')).toBe(true);
    expect(blankNeedsNoScope('blank', null)).toBe(false);
    expect(blankNeedsNoScope('qa', 'Chọn dự án')).toBe(false);
  });
  it('Trống mở trình soạn, mẫu khác về màn xem', () => {
    expect(landingUrl('blank', 'd1')).toBe('/dashboards/d1?edit=1');
    expect(landingUrl('qa', 'd1')).toBe('/dashboards/d1');
  });
});
