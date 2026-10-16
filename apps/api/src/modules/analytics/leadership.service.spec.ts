import { describe, expect, it, vi } from 'vitest';
import { LeadershipService } from './leadership.service';

const NOW = new Date('2026-11-16T12:00:00Z'); // giữa quý 4 → ~51% thời gian đã trôi

function risk(over: Record<string, unknown>) {
  return {
    id: 'r',
    kind: 'RISK',
    status: 'OPEN',
    title: 'Rủi ro',
    score: 10,
    level: 'MEDIUM',
    levelLabel: 'Trung bình',
    project: { id: 'p', key: 'DEMO', name: 'Demo' },
    owner: { id: 'u1', displayName: 'An', email: 'a@x', avatarUrl: null },
    dueDate: null,
    ...over,
  };
}
function goal(over: Record<string, unknown>) {
  return {
    id: 'g',
    name: 'OKR',
    period: '2026-Q4',
    status: 'ACTIVE',
    progress: 10,
    owner: { id: 'u1', displayName: 'An', email: 'a@x', avatarUrl: null },
    ...over,
  };
}
function row(id: string, cells: Array<{ ratio: number | null; over: boolean }>) {
  return {
    user: { id, email: `${id}@x`, displayName: `Người ${id}`, avatarUrl: null },
    weeks: cells.map((c, n) => ({
      weekStart: `2026-11-${16 + n * 7}`,
      assignedHours: c.ratio === null ? 8 : Math.round(40 * c.ratio * 100) / 100,
      capacityHours: c.ratio === null ? 0 : 40,
      ratio: c.ratio,
      overloaded: c.over,
    })),
  };
}
const report = (rows: unknown[]) => ({
  weeks: [
    { start: '2026-11-16', end: '2026-11-22', label: '16/11 – 22/11' },
    { start: '2026-11-23', end: '2026-11-29', label: '23/11 – 29/11' },
  ],
  rows,
});

function make(opts: { raid?: unknown; goals?: unknown; workload?: unknown } = {}) {
  const raid = { list: vi.fn().mockImplementation(() => Promise.resolve(opts.raid ?? [])) };
  const goals = { list: vi.fn().mockImplementation(() => Promise.resolve(opts.goals ?? [])) };
  const resources = {
    workload: vi.fn().mockImplementation(() => Promise.resolve(opts.workload ?? report([]))),
  };
  const svc = new LeadershipService(raid as never, goals as never, resources as never);
  return { svc, raid, goals, resources };
}

describe('LeadershipService.get', () => {
  it('slowGoals chỉ gồm ACTIVE có kỳ YYYY-Qn và chậm ≥15 điểm; sắp theo gap lớn nhất trước', async () => {
    const { svc, goals } = make({
      goals: [
        goal({ id: 'ok', progress: 45 }), // gap ~6 → không chậm
        goal({ id: 'slow1', progress: 30 }), // gap ~21
        goal({ id: 'slow2', progress: 5 }), // gap ~46
        goal({ id: 'free', period: 'FY26', progress: 0 }), // kỳ tự do → bỏ
        goal({ id: 'old', period: '2026-Q3', progress: 40 }), // đã qua → expected 100, gap 60
      ],
    });
    const out = await svc.get('w1', 'u1', NOW);
    expect(goals.list).toHaveBeenCalledWith('w1', { status: 'ACTIVE' }, 'u1');
    expect(out.slowGoals.map((g) => g.id)).toEqual(['old', 'slow2', 'slow1']);
    expect(out.slowGoals[1]).toMatchObject({
      period: '2026-Q4',
      progress: 5,
      owner: { id: 'u1', displayName: 'An' },
    });
    expect(out.slowGoals[1]!.expectedProgress).toBeGreaterThan(48);
  });

  it('topRisks: chỉ RISK OPEN, ≤5, đúng thứ tự score (hoà thì hạn gần hơn trước)', async () => {
    const { svc, raid } = make({
      raid: [
        risk({ id: 'a', score: 25 }),
        risk({ id: 'b', score: 12, dueDate: '2026-12-20T00:00:00.000Z' }),
        risk({ id: 'c', score: 12, dueDate: '2026-12-01T00:00:00.000Z' }),
        risk({ id: 'd', score: 12 }),
        risk({ id: 'e', score: 9 }),
        risk({ id: 'f', score: 8 }),
        risk({ id: 'g', score: 30, kind: 'ISSUE' }),
        risk({ id: 'h', score: 30, status: 'CLOSED' }),
      ],
    });
    const out = await svc.get('w1', 'u1', NOW);
    expect(raid.list).toHaveBeenCalledWith('w1', { kind: 'RISK', status: 'OPEN' }, 'u1');
    expect(out.topRisks.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(out.topRisks[0]).toEqual({
      id: 'a',
      title: 'Rủi ro',
      score: 25,
      level: 'MEDIUM',
      levelLabel: 'Trung bình',
      project: { key: 'DEMO', name: 'Demo' },
      owner: { id: 'u1', displayName: 'An' },
      dueDate: null,
    });
  });

  it('overloaded: bỏ dòng ratio null, lấy tuần quá tải nặng nhất, xếp giảm dần', async () => {
    const { svc, resources } = make({
      workload: report([
        row('ok', [
          { ratio: 0.8, over: false },
          { ratio: 1, over: false },
        ]),
        row('nullcap', [{ ratio: null, over: true }]),
        row('mid', [
          { ratio: 1.2, over: true },
          { ratio: 0.5, over: false },
        ]),
        row('worst', [
          { ratio: 1.1, over: true },
          { ratio: 3.1, over: true },
        ]),
      ]),
    });
    const out = await svc.get('w1', 'u1', NOW);
    expect(resources.workload).toHaveBeenCalledWith(
      'w1',
      { from: '2026-11-16', to: '2026-11-23' },
      'u1',
    );
    expect(out.overloaded.map((o) => o.user.id)).toEqual(['worst', 'mid']);
    expect(out.overloaded[0]).toMatchObject({
      worstRatio: 3.1,
      weekLabel: '23/11 – 29/11',
      assignedHours: 124,
      capacityHours: 40,
    });
  });

  it('một nguồn lỗi → mảng rỗng, hai nguồn còn lại vẫn có', async () => {
    const { svc, raid } = make({
      goals: [goal({ id: 'slow', progress: 5 })],
      workload: report([row('x', [{ ratio: 2, over: true }])]),
    });
    raid.list.mockRejectedValue(new Error('db down'));
    const out = await svc.get('w1', 'u1', NOW);
    expect(out.unavailable).toEqual(['topRisks']); // KHÔNG được giả "không có rủi ro"
    expect(out.topRisks).toEqual([]);
    expect(out.slowGoals).toHaveLength(1);
    expect(out.overloaded).toHaveLength(1);
  });

  it('mọi nguồn lỗi → unavailable đủ ba thẻ', async () => {
    const { svc, raid, goals, resources } = make();
    raid.list.mockRejectedValue(new Error('x'));
    goals.list.mockRejectedValue(new Error('x'));
    resources.workload.mockRejectedValue(new Error('x'));
    const out = await svc.get('w1', 'u1', NOW);
    expect([...out.unavailable].sort()).toEqual(['overloaded', 'slowGoals', 'topRisks']);
  });

  it('cửa sổ tuần theo NGÀY giờ VN: 03:00 thứ Hai VN (còn Chủ nhật UTC) vẫn bắt đầu từ thứ Hai đó', async () => {
    const { svc, resources } = make();
    await svc.get('w1', 'u1', new Date('2026-11-15T20:00:00Z'));
    expect(resources.workload).toHaveBeenCalledWith(
      'w1',
      { from: '2026-11-16', to: '2026-11-23' },
      'u1',
    );
  });

  it('workspace trống → ba mảng rỗng', async () => {
    const { svc } = make();
    expect(await svc.get('w1', 'u1', NOW)).toEqual({
      topRisks: [],
      slowGoals: [],
      overloaded: [],
      unavailable: [],
    });
  });
});
