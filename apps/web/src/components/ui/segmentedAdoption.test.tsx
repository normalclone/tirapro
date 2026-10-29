import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('SegmentedControl: không chọn gì + tooltip riêng', () => {
  const options = [
    { value: 'GREEN', label: 'Tốt', title: 'Đang ổn' },
    { value: 'YELLOW', label: 'Cần chú ý' },
  ] as const;
  it('value = null → không mục nào được chọn, mục đầu là điểm vào Tab; bấm chọn mục đầu vẫn phát onChange', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        value={null}
        onChange={() => undefined}
        options={options}
        ariaLabel="Mức"
      />,
    );
    expect(html).not.toContain('aria-checked="true"');
    expect(html.match(/aria-checked="false"/g)?.length).toBe(2);
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html.indexOf('tabindex="0"')).toBeLessThan(html.indexOf('Cần chú ý'));
  });
  it('option.title thay tooltip mặc định (nhãn)', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        value="GREEN"
        onChange={() => undefined}
        options={options}
        ariaLabel="Mức"
      />,
    );
    expect(html).toContain('title="Đang ổn"');
    expect(html).toContain('title="Cần chú ý"');
  });
});

describe('015a · nhóm chọn ngắn dùng SegmentedControl, bỏ nút radio tự viết', () => {
  const SITES: Record<string, number> = {
    'features/projects/HealthOverrideCard.tsx': 1,
    'features/intake/ReportIssueModal.tsx': 2,
    'features/raid/RaidEditorModal.tsx': 3, // loại RAID + thang xác suất + thang ảnh hưởng
  };
  for (const [f, n] of Object.entries(SITES)) {
    it(`${f}: ${n} nhóm qua <SegmentedControl>, không còn role="radio"/điều hướng phím thủ công`, () => {
      const s = read(f);
      expect(s).toContain("from '@/components/ui/SegmentedControl'");
      expect(s).not.toContain('role="radio"');
      expect(s).not.toContain('role="radiogroup"');
      expect(s).not.toMatch(/radioGroupKeyDown|onRadioKey|radioRefs/);
      const uses = s.match(/<SegmentedControl\b/g)?.length ?? 0;
      expect(uses, f).toBeGreaterThanOrEqual(1);
      if (f.includes('Raid')) expect(uses).toBeGreaterThanOrEqual(2); // ScalePicker dùng lại 1 lần cho cả hai thang
    });
  }
  it('mỗi nhóm giữ nhãn truy cập cũ', () => {
    expect(read('features/projects/HealthOverrideCard.tsx')).toContain('ariaLabel="Mức ghi đè"');
    const r = read('features/intake/ReportIssueModal.tsx');
    expect(r).toContain('ariaLabel="Loại yêu cầu"');
    expect(r).toContain('ariaLabel="Chế độ form"');
    const raid = read('features/raid/RaidEditorModal.tsx');
    expect(raid).toContain('ariaLabel="Loại rủi ro hoặc vướng mắc"');
    expect(raid).toContain('ariaLabel={ariaLabel}');
  });
  it('Sức khoẻ: vẫn cho "chưa chọn" (level null) — không ép chọn sẵn mức nào', () => {
    const s = read('features/projects/HealthOverrideCard.tsx');
    expect(s).toContain('useState<ProjectHealth | null>(current?.level ?? null)');
    expect(s).toMatch(/<SegmentedControl[^>]*value=\{level\}/s);
  });
});
