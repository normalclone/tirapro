import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAB_CLEARANCE_PX, FAB_EDGE_PX } from './layoutTokens';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('FAB không che nội dung', () => {
  it('Toaster có offset để né FAB', () =>
    expect(src('App.tsx')).toMatch(/<Toaster[\s\S]*?offset=/));
  it('Toaster dùng hằng FAB_CLEARANCE_PX (không số cứng)', () =>
    expect(src('App.tsx')).toMatch(/FAB_CLEARANCE_PX/));
  it('pageContainer chừa đệm đáy cho FAB', () => {
    const page = src('components/layout/page.ts');
    expect(page).toMatch(/pb-28/);
    expect(page).not.toMatch(/\bpy-8\b/);
  });
  it('FAB dùng hằng cạnh thay số cứng', () => {
    expect(src('components/layout/FloatingActions.tsx')).toMatch(/FAB_EDGE_PX/);
    expect(src('components/layout/FloatingActions.tsx')).not.toMatch(/bottom-6 right-6/);
  });
  it('khoảng chừa toast lớn hơn chiều cao FAB + lề (56 + 24)', () =>
    expect(FAB_CLEARANCE_PX).toBeGreaterThanOrEqual(56 + FAB_EDGE_PX));
  it('các vùng cuộn toàn màn có đệm đáy', () => {
    for (const f of [
      'features/board/BoardPage.tsx',
      'features/backlog/BacklogPage.tsx',
      'features/triage/TriagePage.tsx',
      'features/tree/TreePage.tsx',
      'features/gantt/GanttPage.tsx',
    ])
      expect(src(f), f).toMatch(/\bpb-2[48]\b/);
  });
  it('thanh thao tác hàng loạt né FAB', () =>
    expect(src('features/backlog/BulkActionBar.tsx')).toMatch(/lg:mr-24/));
});
