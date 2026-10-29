import { describe, expect, it } from 'vitest';
import { DOC_GROUPS, DOC_TOPICS } from '@/features/docs/docsIndex';
import { SCREENS, screenInfoOf, screenPattern } from './screens';

describe('screenPattern', () => {
  it('chuẩn hoá đường dẫn có tham số về mẫu', () => {
    expect(screenPattern('/p/DEMO/board')).toBe('/p/:key/board');
    expect(screenPattern('/issue/DEMO-TASK-1')).toBe('/issue/:key');
    expect(screenPattern('/filters/abc')).toBe('/filters');
    expect(screenPattern('/dashboards/x1')).toBe('/dashboards/:id');
    expect(screenPattern('/p/DEMO/config/workflows')).toBe('/p/:key/config');
    expect(screenPattern('/admin/system')).toBe('/admin');
    expect(screenPattern('/members/')).toBe('/members');
  });
});

describe('screenInfoOf', () => {
  it('màn có mục riêng, màn thuộc nhóm, màn lạ', () => {
    expect(screenInfoOf('/p/X/backlog').name).toBe('Việc chờ');
    expect(screenInfoOf('/issue/ABC-1').name).toBe('Công việc');
    expect(screenInfoOf('/settings/priorities').name).toBe('Cài đặt');
    expect(screenInfoOf('/manage/risks').name).toContain('Danh mục');
    expect(screenInfoOf('/connect/integrations').name).toBe('Kết nối');
    expect(screenInfoOf('/khong-co').name).toBe('Tirapro');
  });
  it('mọi màn có mô tả, 2–4 chip và docAnchor có thật trong Docs', () => {
    const ids = new Set([...DOC_GROUPS.flatMap((g) => g.items), ...DOC_TOPICS].map((e) => e.id));
    for (const s of SCREENS) {
      expect(s.purpose.length, s.pattern).toBeGreaterThan(20);
      expect(s.chips.length, s.pattern).toBeGreaterThanOrEqual(2);
      expect(s.chips.length, s.pattern).toBeLessThanOrEqual(4);
      if (s.docAnchor) expect(ids.has(s.docAnchor), `${s.pattern} → ${s.docAnchor}`).toBe(true);
    }
  });
  it('mẫu màn không trùng', () => {
    expect(new Set(SCREENS.map((s) => s.pattern)).size).toBe(SCREENS.length);
  });
});
