import { describe, expect, it } from 'vitest';
import { DASHBOARD_WIDGET_TYPES, widgetInputSchema } from '@tirapro/shared';
import { WIDGET_REGISTRY, WIDGET_TYPE_ORDER } from './registry';

const input = (type: string, config: Record<string, unknown>, w: number) => ({
  type,
  title: WIDGET_REGISTRY[type as keyof typeof WIDGET_REGISTRY].defaultTitle,
  config,
  position: { order: 0, w },
});

describe('WIDGET_REGISTRY', () => {
  it('có đủ 9 loại ô, khớp danh sách loại của shared', () => {
    expect([...WIDGET_TYPE_ORDER].sort()).toEqual([...DASHBOARD_WIDGET_TYPES].sort());
  });

  it.each(Object.entries(WIDGET_REGISTRY))(
    '%s: defaultConfig hợp lệ khi đã chọn dự án',
    (type, def) => {
      const parsed = widgetInputSchema.safeParse(
        input(type, { ...def.defaultConfig, projectId: 'p1' }, def.defaultW),
      );
      expect(parsed.success).toBe(true);
    },
  );

  it.each(Object.entries(WIDGET_REGISTRY))(
    '%s: chưa chọn dự án thì chỉ loại BẮT BUỘC dự án mới bị từ chối',
    (type, def) => {
      const parsed = widgetInputSchema.safeParse(input(type, def.defaultConfig, def.defaultW));
      expect(parsed.success).toBe(def.project !== 'required');
    },
  );

  it('mỗi loại có tiêu đề mặc định, mô tả và cỡ mặc định 1–3', () => {
    for (const def of Object.values(WIDGET_REGISTRY)) {
      expect(def.defaultTitle.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(def.defaultW);
    }
  });
});
