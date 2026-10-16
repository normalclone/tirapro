import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKFLOW_TEMPLATES, PROJECT_TEMPLATES } from '@tirapro/types';
import { createProjectSchema } from './schemas/common';

describe('PROJECT_TEMPLATES', () => {
  it('có đúng 3 mẫu, key duy nhất', () => {
    expect(PROJECT_TEMPLATES.map((t) => t.key)).toEqual(['scrum', 'kanban', 'requirements']);
  });
  it.each(PROJECT_TEMPLATES)('$key: quy trình tồn tại, đủ khép kín', (t) => {
    const wf = DEFAULT_WORKFLOW_TEMPLATES.find((w) => w.name === t.workflowName);
    expect(wf, t.workflowName).toBeDefined();
    const names = new Set(wf!.statuses.map((s) => s.name));
    expect(wf!.statuses.filter((s) => s.isInitial)).toHaveLength(1);
    expect(wf!.statuses.some((s) => s.category === 'DONE')).toBe(true);
    for (const tr of wf!.transitions) {
      expect(names.has(tr.to), `${tr.name} → ${tr.to}`).toBe(true);
      if (tr.from) expect(names.has(tr.from), `${tr.name} từ ${tr.from}`).toBe(true);
    }
    expect(wf!.boardType).toBe(t.projectType);
  });
  it('mẫu mới đặt cuối: find(KANBAN) vẫn trả "Kanban mặc định"', () => {
    expect(DEFAULT_WORKFLOW_TEMPLATES.find((w) => w.boardType === 'KANBAN')!.name).toBe(
      'Kanban mặc định',
    );
  });
  it('createProjectSchema nhận templateKey hợp lệ và từ chối khoá lạ', () => {
    expect(
      createProjectSchema.safeParse({ name: 'A', key: 'AB', templateKey: 'requirements' }).success,
    ).toBe(true);
    expect(
      createProjectSchema.safeParse({ name: 'A', key: 'AB', templateKey: 'xyz' }).success,
    ).toBe(false);
  });
});
