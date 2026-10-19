import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

/** Sáu nơi có cặp ngày bắt đầu–kết thúc (kiểm kê C1 §030) phải dùng DateRangeInput, không tự ghép hai DateInput. */
const SITES = [
  'features/backlog/StartSprintDialog.tsx',
  'features/backlog/SprintEditDialog.tsx',
  'features/clients/ContractEditorModal.tsx',
  'features/portfolio/ProgramEditorModal.tsx',
  'features/resources/TimeOffPanel.tsx',
  'features/resources/AllocationsPanel.tsx',
] as const;

describe('030 — cặp ngày dùng DateRangeInput', () => {
  it.each(SITES)('%s', (rel) => {
    const src = read(rel);
    expect(src).toContain("from '@/components/ui/DateRangeInput'");
    expect(src).toContain('<DateRangeInput');
    expect(src).not.toContain('<DateInput');
  });
});
