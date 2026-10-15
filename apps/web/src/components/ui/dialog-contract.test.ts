import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..'); // apps/web/src

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('hợp đồng Dialog', () => {
  const all = files(SRC).map((f) => ({ f: relative(SRC, f), text: readFileSync(f, 'utf8') }));

  it('không file nào chặn `open` bằng early-return trước khi vẽ Dialog (mất hiệu ứng đóng)', () => {
    const bad = all
      .filter(({ text }) => /if \((?:[^)]*\|\| )?!open\b[^)]*\)\s*return null/.test(text))
      .map((x) => x.f);
    expect(bad, `Bỏ early-return, dùng useRetained cho đối tượng đích: ${bad.join(', ')}`).toEqual(
      [],
    );
  });

  it('không dùng `<Dialog open` trần (luôn mount) ngoài components/ui', () => {
    const bad = all
      .filter(
        ({ f, text }) =>
          !f.startsWith('components/ui') && /<Dialog(?:\s+open\s|\s*\n\s*open\s*\n)/.test(text),
      )
      .map((x) => x.f);
    expect(bad, `Truyền open thật: ${bad.join(', ')}`).toEqual([]);
  });

  it('PlanningPanel dựng trên Dialog dùng chung (focus-trap, data-state)', () => {
    const t = all.find((x) => x.f === 'features/planning/PlanningPanel.tsx')!.text;
    expect(t).toContain("from '@/components/ui/Dialog'");
    expect(t).not.toMatch(/role="dialog"/);
  });
});
