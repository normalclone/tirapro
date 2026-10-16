import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('thuật ngữ trang Việc mới vào (UX_CONVENTIONS §19)', () => {
  it('tiêu đề trang khớp tên tab, không còn "Phân loại (Triage)"', () => {
    const page = src('features/triage/TriagePage.tsx');
    expect(page).toContain('>Việc mới vào</span>');
    expect(page).not.toMatch(/Phân loại|\(Triage\)/);
    expect(src('features/projects/ProjectLayout.tsx')).toContain("label: 'Việc mới vào'");
  });
});
