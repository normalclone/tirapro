import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Lịch trình — chú giải thanh công việc (logbug #25)', () => {
  it('tooltip của thanh có tên công việc, không chỉ mã + ngày', () => {
    const src = readFileSync(new URL('./GanttPage.tsx', import.meta.url), 'utf8');
    expect(src).toContain('`${s.issue.key} · ${s.issue.summary}`');
  });
});
