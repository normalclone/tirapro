import { describe, expect, it } from 'vitest';
import { buildSeries } from './progressSeries';
import type { GoalProgressHistory } from './api';

const kr = (id: string, points: Array<[string, number, number]>) => ({
  id,
  name: `KR ${id}`,
  unit: 'NUMBER' as const,
  unitLabel: 'bug',
  source: 'OPEN_BUGS' as const,
  points: points.map(([date, value, progress]) => ({ date, value, progress, auto: true })),
  scopeNote: null,
});

const history = (over: Partial<GoalProgressHistory> = {}): GoalProgressHistory => ({
  period: '2026-Q4',
  from: '2026-10-13',
  to: '2026-10-16',
  keyResults: [
    kr('a', [
      ['2026-10-13', 6, 0],
      ['2026-10-14', 6, 0],
      ['2026-10-15', 3, 50],
      ['2026-10-16', 3, 50],
    ]),
    kr('b', [
      ['2026-10-15', 2, 20],
      ['2026-10-16', 4, 40],
    ]),
  ],
  objective: [
    { date: '2026-10-13', progress: 0 },
    { date: '2026-10-14', progress: 0 },
    { date: '2026-10-15', progress: 35 },
    { date: '2026-10-16', progress: 45 },
  ],
  // Mốc kỳ vọng do BE trả: từ đầu cửa sổ tới hết quý (đã làm tròn, tăng dần).
  expected: [
    { date: '2026-10-13', progress: 13 },
    { date: '2026-10-14', progress: 14 },
    { date: '2026-10-15', progress: 15 },
    { date: '2026-10-16', progress: 16 },
    { date: '2026-12-30', progress: 99 },
    { date: '2026-12-31', progress: 100 },
  ],
  ...over,
});

describe('buildSeries', () => {
  it('giữ thứ tự ngày tăng dần, không trùng; KR không có điểm trước dòng dữ liệu đầu', () => {
    const { rows } = buildSeries(history(), { extendToPeriodEnd: false });
    expect(rows.map((r) => r.date)).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ]);
    const b = rows.map((r) => r.progress[1]);
    expect(b).toEqual([null, null, 20, 40]);
    expect(rows.map((r) => r.objective)).toEqual([0, 0, 35, 45]);
  });

  it('mỗi dòng giữ giá trị thật để tooltip hiện số kèm đơn vị', () => {
    const { rows, lines } = buildSeries(history(), { extendToPeriodEnd: false });
    expect(rows[2]!.value[0]).toBe(3);
    expect(rows[0]!.value[1]).toBeNull();
    expect(lines.map((l) => [l.id, l.name, l.unitLabel])).toEqual([
      ['a', 'KR a', 'bug'],
      ['b', 'KR b', 'bug'],
    ]);
  });

  it('kéo trục tới hết quý theo `expected` của BE; đường KR dừng ở hôm nay', () => {
    const { rows } = buildSeries(history());
    expect(rows[0]!.date).toBe('2026-10-13');
    expect(rows.at(-1)!.date).toBe('2026-12-31');
    expect(rows.at(-1)!.expected).toBe(100);
    expect(rows.at(-1)!.progress[0]).toBeNull();
    expect(rows.at(-1)!.objective).toBeNull();
    // ngày dữ liệu cuối còn đường KR
    expect(rows.find((r) => r.date === '2026-10-16')!.progress[0]).toBe(50);
  });

  it('kỳ tự do: expected null ở mọi dòng và không kéo trục', () => {
    const { rows } = buildSeries(history({ period: 'H2', expected: null }));
    expect(rows.at(-1)!.date).toBe('2026-10-16');
    expect(rows.every((r) => r.expected === null)).toBe(true);
  });

  it('KR bị ẩn (points rỗng) vẫn có dòng chú thích nhưng không có dữ liệu', () => {
    const h = history();
    h.keyResults.push({
      ...kr('c', []),
      scopeNote: 'Dự án riêng tư — bạn không có quyền xem lịch sử',
    });
    const { lines } = buildSeries(h, { extendToPeriodEnd: false });
    expect(lines.find((l) => l.id === 'c')).toMatchObject({ hasData: false });
    expect(lines.find((l) => l.id === 'a')).toMatchObject({ hasData: true });
  });
});
