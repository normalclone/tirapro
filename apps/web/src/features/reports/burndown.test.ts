import { describe, expect, it } from 'vitest';
import {
  orderSprints,
  pickDefaultSprint,
  resolveSprint,
  sprintLabel,
  todayMarker,
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

describe('sprintLabel', () => {
  it('ghi trạng thái cạnh tên', () => {
    expect(sprintLabel(sp('a', 'ACTIVE', 2))).toBe('Sprint 2 · đang chạy');
    expect(sprintLabel(sp('c', 'CLOSED', 1))).toBe('Sprint 1 · đã kết thúc');
    expect(sprintLabel(sp('f', 'FUTURE', 3))).toBe('Sprint 3 · chưa bắt đầu');
  });
});
