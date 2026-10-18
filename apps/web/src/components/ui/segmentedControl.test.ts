import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SegmentedControlLabel } from './SegmentedControl';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const control = () => read('components/ui/SegmentedControl.tsx');

describe('SegmentedControl dùng chung', () => {
  it('là radiogroup: mục role="radio" + aria-checked, điều hướng mũi tên bỏ qua mục tắt', () => {
    const src = control();
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('role="radio"');
    expect(src).toContain('aria-checked');
    expect(src).toContain('radioGroupKeyDownSkipDisabled');
    expect(src).not.toContain('role="tab');
  });
  it('chỉ phát onChange khi chọn mục khác (qua shouldEmitChange)', () => {
    const src = control();
    expect(src).toContain('shouldEmitChange(value, o.value)');
    expect(src).not.toMatch(/onClick=\{\(\) => onChange\(o\.value\)\}/);
  });
  it('roving tabindex, aria-label/labelledby, vô hiệu nhóm bằng token disabled, vùng chạm 44px', () => {
    const src = control();
    expect(src).toContain('tabIndex');
    expect(src).toContain('aria-label');
    expect(src).toContain('aria-labelledby');
    expect(src).toContain('aria-disabled');
    expect(src).toContain('bg-disabled-bg');
    expect(src).toContain('text-disabled-fg');
    expect(src).toContain('SEGMENT_TOUCH_HIT');
  });
  it('không còn Segmented tự chế trong features; mọi nơi dùng đều có ariaLabel', () => {
    const qb = read('features/saved-filters/QueryBuilder.tsx');
    expect(qb).not.toMatch(/export function Segmented\b/);
    for (const f of [
      'features/saved-filters/QueryBuilder.tsx',
      'features/saved-filters/FiltersPage.tsx',
      'features/board/BoardSettingsDialog.tsx',
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/<Segmented\b/);
      const uses = src.match(/<SegmentedControl\b[\s\S]*?\/>/g) ?? [];
      expect(uses.length, f).toBeGreaterThan(0);
      for (const u of uses) expect(u, f).toMatch(/ariaLabel(ledby)?=/);
    }
  });
});

describe('SegmentedControl: nhãn truy cập bắt buộc (kiểm bằng typecheck)', () => {
  it('thiếu cả ariaLabel lẫn ariaLabelledby thì lỗi biên dịch; có một trong hai thì hợp lệ', () => {
    // @ts-expect-error — thiếu nhãn
    const none: SegmentedControlLabel = {};
    const a: SegmentedControlLabel = { ariaLabel: 'Hướng' };
    const b: SegmentedControlLabel = { ariaLabelledby: 'lbl' };
    // @ts-expect-error — không truyền cả hai
    const both: SegmentedControlLabel = { ariaLabel: 'x', ariaLabelledby: 'y' };
    expect([none, a, b, both]).toHaveLength(4);
  });
});
