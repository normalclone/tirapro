import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}
const files = walk(SRC).map((f) => ({ f: f.slice(SRC.length + 1), s: readFileSync(f, 'utf8') }));

describe('một bản StatRow + BulletBar (không còn bản cũ)', () => {
  it('StatStrip / StatTile / PaceBar / ProgressBar cục bộ / StatRow cục bộ đã biến mất', () => {
    const offenders = files.filter(
      ({ f, s }) =>
        /\bStatStrip\b|\bStatTile\b|\bPaceBar\b/.test(s) ||
        (f === 'features/goals/GoalsPage.tsx' && /function ProgressBar\b/.test(s)) ||
        (f !== 'components/ui/StatRow.tsx' && /function StatRow\b/.test(s)),
    );
    expect(offenders.map((o) => o.f)).toEqual([]);
  });
  it('StatRow/BulletBar chỉ định nghĩa ở components/ui', () => {
    const defs = files.filter(({ s }) => /export function (StatRow|BulletBar)\b/.test(s));
    expect(defs.map((d) => d.f).sort()).toEqual([
      'components/ui/BulletBar.tsx',
      'components/ui/StatRow.tsx',
    ]);
  });
  it('không còn ô số khổng lồ (text-2xl/3xl/4xl) trong ô chỉ số', () => {
    for (const f of [
      'features/dashboards/widgets/StatNumberWidget.tsx',
      'features/dashboard/DashboardPage.tsx',
      'features/reports/charts.tsx',
      'features/admin/_ui.tsx',
      'components/ui/StatRow.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/text-(2|3|4)xl/);
    }
  });
});

describe('nơi dùng', () => {
  it('ô "Chỉ số" của dashboard tuỳ biến (STAT_NUMBER) vẫn là loại cũ nhưng vẽ bằng StatRow', () => {
    const w = read('features/dashboards/widgets/StatNumberWidget.tsx');
    expect(w).toMatch(/StatRow/);
    expect(read('features/dashboards/registry.tsx')).toMatch(/STAT_NUMBER:/);
  });
  it('OKR: thanh KR và Objective là BulletBar có vạch kỳ vọng', () => {
    const g = read('features/goals/GoalsPage.tsx');
    expect(g.match(/<BulletBar/g)?.length).toBeGreaterThanOrEqual(2);
    expect(g).toMatch(/expectedProgress/);
    expect(read('features/goals/api.ts').match(/expectedProgress: number \| null/g)).toHaveLength(
      2,
    );
  });
  it('thẻ OKR chậm của lãnh đạo dùng BulletBar', () => {
    expect(read('features/dashboard/LeadershipCards.tsx')).toMatch(/<BulletBar/);
  });
  it('Báo cáo sprint: Hoàn thành so với cam kết, Velocity TB so với điểm sprint này', () => {
    const s = read('features/reports/SprintTab.tsx');
    expect(s).toMatch(/targetLabel: 'cam kết'/);
    expect(s).toMatch(/targetLabel: 'velocity TB'/);
  });
});
