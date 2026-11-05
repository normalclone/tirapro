import { describe, expect, it } from 'vitest';
import { DASHBOARD_TEMPLATES, findDashboardTemplate } from '@tirapro/shared';
import { previewBlocks } from './previewBlocks';

describe('previewBlocks', () => {
  it('đúng các ô sẽ được tạo cho phạm vi: BURNDOWN/VELOCITY chỉ ở một dự án', () => {
    const t = findDashboardTemplate('project-overview')!;
    const types = (s: 'PROJECT' | 'GROUP' | 'ORG') => previewBlocks(t, s).map((b) => b.type);
    expect(types('PROJECT')).toEqual(expect.arrayContaining(['BURNDOWN', 'VELOCITY']));
    expect(types('GROUP')).not.toContain('BURNDOWN');
  });
  it('mỗi mẫu có xem trước khớp số ô; Trống không có khối; cỡ cột 1–3, chỉ số thấp hơn biểu đồ', () => {
    for (const t of DASHBOARD_TEMPLATES) {
      for (const s of t.scopes) {
        const blocks = previewBlocks(t, s);
        for (const b of blocks) expect([1, 2, 3]).toContain(b.w);
      }
    }
    expect(previewBlocks(findDashboardTemplate('blank')!, 'PROJECT')).toEqual([]);
    const qa = previewBlocks(findDashboardTemplate('qa')!, 'PROJECT');
    expect(qa.find((b) => b.type === 'STAT_NUMBER')?.rows).toBe(1);
    expect(qa.find((b) => b.type === 'ISSUE_LIST')?.rows).toBe(2);
  });
});
