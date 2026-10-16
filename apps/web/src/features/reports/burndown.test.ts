import { describe, expect, it } from 'vitest';
import {
  burndownSummary,
  orderSprints,
  pickDefaultSprint,
  resolveSprint,
  todayMarker,
  velocitySummary,
  type SprintLike,
} from './burndown';

const sp = (id: string, state: SprintLike['state'], sequence: number): SprintLike => ({
  id,
  name: `Sprint ${sequence}`,
  state,
  sequence,
});

describe('todayMarker', () => {
  const series = [
    { date: '2026-10-13', ideal: 20, remaining: 20 },
    { date: '2026-10-14', ideal: 10, remaining: 12 },
    { date: '2026-10-15', ideal: 0, remaining: null },
  ];

  it('trả ngày khi nằm trong series, null khi ngoài khoảng', () => {
    expect(todayMarker(series, '2026-10-14')).toBe('2026-10-14');
    expect(todayMarker(series, '2026-10-20')).toBeNull();
    expect(todayMarker(series, '2026-10-12')).toBeNull();
  });

  it('series rỗng → null', () => {
    expect(todayMarker([], '2026-10-14')).toBeNull();
  });
});

describe('pickDefaultSprint', () => {
  it('ACTIVE đứng trước CLOSED mới nhất, rồi mới tới FUTURE', () => {
    const list = [
      sp('c1', 'CLOSED', 1),
      sp('a', 'ACTIVE', 3),
      sp('c2', 'CLOSED', 2),
      sp('f', 'FUTURE', 4),
    ];
    expect(pickDefaultSprint(list)?.id).toBe('a');
  });

  it('không có ACTIVE → CLOSED có sequence lớn nhất', () => {
    const list = [
      sp('c1', 'CLOSED', 1),
      sp('c3', 'CLOSED', 3),
      sp('c2', 'CLOSED', 2),
      sp('f', 'FUTURE', 4),
    ];
    expect(pickDefaultSprint(list)?.id).toBe('c3');
  });

  it('chỉ còn FUTURE → FUTURE có sequence lớn nhất', () => {
    expect(pickDefaultSprint([sp('f1', 'FUTURE', 1), sp('f2', 'FUTURE', 2)])?.id).toBe('f2');
  });

  it('rỗng → undefined', () => {
    expect(pickDefaultSprint([])).toBeUndefined();
  });
});

describe('resolveSprint', () => {
  const list = [sp('c1', 'CLOSED', 1), sp('a', 'ACTIVE', 2)];

  it('id còn tồn tại → đúng sprint đó', () => {
    expect(resolveSprint(list, 'c1')?.id).toBe('c1');
  });

  it('id không còn / rỗng → quay về mặc định', () => {
    expect(resolveSprint(list, 'đã-xoá')?.id).toBe('a');
    expect(resolveSprint(list, null)?.id).toBe('a');
  });
});

describe('orderSprints', () => {
  it('Đang chạy → Đã kết thúc (mới nhất trước) → Chưa bắt đầu (sớm nhất trước)', () => {
    const list = [
      sp('f2', 'FUTURE', 5),
      sp('c1', 'CLOSED', 1),
      sp('f1', 'FUTURE', 4),
      sp('a', 'ACTIVE', 3),
      sp('c2', 'CLOSED', 2),
    ];
    expect(orderSprints(list).map((s) => s.id)).toEqual(['a', 'c2', 'c1', 'f1', 'f2']);
  });

  it('không làm đổi mảng gốc', () => {
    const list = [sp('c1', 'CLOSED', 1), sp('a', 'ACTIVE', 2)];
    orderSprints(list);
    expect(list.map((s) => s.id)).toEqual(['c1', 'a']);
  });
});

describe('burndownSummary', () => {
  const base = {
    sprintId: 's',
    sprintName: 'Sprint 2',
    committedPoints: 20,
    start: null,
    end: null,
    today: '2026-10-14',
  };

  it('nêu cam kết và điểm còn lại ở ngày cuối có số liệu (bỏ qua ngày tương lai null)', () => {
    const text = burndownSummary({
      ...base,
      series: [
        { date: '2026-10-13', ideal: 20, remaining: 20 },
        { date: '2026-10-14', ideal: 10, remaining: 12 },
        { date: '2026-10-15', ideal: 0, remaining: null },
      ],
    });
    expect(text).toBe(
      'Burndown Sprint 2: cam kết 20 điểm. Đến 14/10/2026 còn 12 điểm, đường lý tưởng 10 điểm.',
    );
  });

  it('chưa có số liệu còn lại', () => {
    const text = burndownSummary({
      ...base,
      series: [{ date: '2026-10-15', ideal: 0, remaining: null }],
    });
    expect(text).toContain('Chưa có số liệu điểm còn lại');
  });
});

describe('velocitySummary', () => {
  it('trung bình + từng sprint', () => {
    const text = velocitySummary({
      averageCompleted: 16,
      sprints: [{ sprintId: 'a', sprintName: 'Sprint 1', committed: 18, completed: 16 }],
    });
    expect(text).toBe('Velocity: trung bình hoàn thành 16 điểm. Sprint 1 hoàn thành 16/18 điểm.');
  });

  it('rỗng', () => {
    expect(velocitySummary({ averageCompleted: 0, sprints: [] })).toBe(
      'Velocity: chưa có sprint nào đã đóng.',
    );
  });
});
