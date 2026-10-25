import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

/** Bốn bảng màu tự viết + ô màu native ở form Nhãn (kiểm kê C1 §029) phải dùng ColorPicker/LABEL_PALETTE. */
const SITES: [string, RegExp[]][] = [
  ['features/settings/RolesPage.tsx', [/PRESET_COLORS/]],
  ['features/teams/TeamEditorModal.tsx', [/TEAM_COLORS/, /TEAM_COLOR_NAMES/]],
  ['features/portfolio/ProgramEditorModal.tsx', [/PROGRAM_COLORS/]],
  ['features/planning/PlanningPanel.tsx', [/MILESTONE_COLORS/, /MILESTONE_COLOR_NAMES/]],
  ['features/project-config/LabelsSection.tsx', [/DEFAULT_LABEL_COLOR\s*=\s*'#/, /type="color"/]],
];

describe('029a — một bảng màu và một bộ chọn màu', () => {
  it.each(SITES)('%s', (rel, gone) => {
    const src = read(rel);
    expect(src).toContain("from '@/components/ui/ColorPicker'");
    expect(src).toContain('<ColorPicker');
    for (const re of gone) expect(src).not.toMatch(re);
  });
  it('form Nhãn: không còn <input type=color>, cả thêm lẫn sửa dùng ColorPicker', () => {
    const src = read('features/project-config/LabelsSection.tsx');
    expect(src.match(/<ColorPicker/g)?.length).toBe(2);
  });
  it('vai trò lưu chuỗi OKLCH như cũ (format="oklch"); nhãn/nhóm/chương trình/mốc lưu hex', () => {
    expect(read('features/settings/RolesPage.tsx')).toMatch(/format="oklch"/);
    for (const rel of [
      'features/teams/TeamEditorModal.tsx',
      'features/portfolio/ProgramEditorModal.tsx',
      'features/planning/PlanningPanel.tsx',
      'features/project-config/LabelsSection.tsx',
    ])
      expect(read(rel)).not.toMatch(/format="oklch"/);
  });
  it('chip nhãn ở thẻ Board và dòng Việc chờ tô màu qua labelTone (không còn chữ = màu thô)', () => {
    for (const rel of ['features/board/Card.tsx', 'features/backlog/IssueRow.tsx']) {
      const src = read(rel);
      expect(src).toContain('labelToneStyle');
      expect(src).not.toContain('color-mix');
    }
  });
});
