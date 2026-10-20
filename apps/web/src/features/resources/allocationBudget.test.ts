import { describe, expect, it } from 'vitest';
import { allocationBudgets, workingDaysBetween, type BudgetAllocation } from './allocationBudget';

const A = (
  userId: string,
  projectId: string,
  percent: number,
  startDate: string,
  endDate: string,
): BudgetAllocation => ({
  userId,
  projectId,
  percent,
  startDate,
  endDate,
  project: { id: projectId, key: projectId.toUpperCase(), name: `Dự án ${projectId}` },
  user: { id: userId, displayName: `Người ${userId}` },
});

describe('workingDaysBetween (bao gồm hai đầu, chỉ T2–T6)', () => {
  it('một tuần đủ = 5 ngày; đầu/cuối cùng ngày = 1', () => {
    expect(workingDaysBetween('2026-10-19', '2026-10-25')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    expect(workingDaysBetween('2026-10-21', '2026-10-21')).toEqual(['2026-10-21']);
  });
  it('đoạn chỉ có cuối tuần / đảo ngược / hỏng → rỗng', () => {
    expect(workingDaysBetween('2026-10-24', '2026-10-25')).toEqual([]);
    expect(workingDaysBetween('2026-10-23', '2026-10-19')).toEqual([]);
    expect(workingDaysBetween('xx', '2026-10-19')).toEqual([]);
  });
});

describe('allocationBudgets — cộng dồn phân bổ chồng nhau theo NGÀY, lấy ngày đỉnh', () => {
  const from = '2026-10-19';
  const to = '2026-10-25';

  it('một phân bổ phủ cả khoảng: đỉnh = % của nó, ngày đỉnh = ngày làm việc đầu', () => {
    const [b] = allocationBudgets([A('u1', 'p1', 60, '2026-10-01', '2026-12-01')], from, to);
    expect(b!.peak).toEqual({ percent: 60, day: '2026-10-19' });
    expect(b!.overDays).toBe(0);
    expect(b!.perProject).toEqual([{ projectId: 'p1', key: 'P1', name: 'Dự án p1', percent: 60 }]);
  });

  it('chồng nhau chỉ một số ngày: đỉnh 130% vào ngày đầu của phần chồng, đếm số ngày vượt', () => {
    // p1 60% cả tuần; p2 70% từ T4 (21/10) tới hết khoảng → T2,T3: 60%; T4,T5,T6: 130%
    const [b] = allocationBudgets(
      [
        A('u1', 'p1', 60, '2026-10-19', '2026-10-25'),
        A('u1', 'p2', 70, '2026-10-21', '2026-10-30'),
      ],
      from,
      to,
    );
    expect(b!.peak).toEqual({ percent: 130, day: '2026-10-21' });
    expect(b!.overDays).toBe(3);
    expect(b!.workingDays).toBe(5);
    // chia theo dự án TẠI ngày đỉnh, % giảm dần
    expect(b!.perProject.map((p) => [p.key, p.percent])).toEqual([
      ['P2', 70],
      ['P1', 60],
    ]);
  });

  it('hai phân bổ KHÔNG chồng nhau (nối tiếp) → không vượt, dù tổng số học > 100', () => {
    const [b] = allocationBudgets(
      [
        A('u1', 'p1', 80, '2026-10-19', '2026-10-21'),
        A('u1', 'p2', 80, '2026-10-22', '2026-10-25'),
      ],
      from,
      to,
    );
    expect(b!.peak.percent).toBe(80);
    expect(b!.overDays).toBe(0);
  });

  it('đúng 100% không phải vượt', () => {
    const [b] = allocationBudgets(
      [A('u1', 'p1', 50, from, to), A('u1', 'p2', 50, from, to)],
      from,
      to,
    );
    expect(b!.peak.percent).toBe(100);
    expect(b!.overDays).toBe(0);
  });

  it('cắt theo khoảng: phân bổ chỉ chồng nhau NGOÀI khoảng đang xem thì không tính', () => {
    const [b] = allocationBudgets(
      [
        A('u1', 'p1', 90, '2026-10-01', '2026-10-31'),
        A('u1', 'p2', 90, '2026-10-26', '2026-10-31'),
      ],
      from,
      to,
    );
    expect(b!.peak.percent).toBe(90);
  });

  it('chồng nhau chỉ vào cuối tuần → bỏ qua (máy chủ cũng chỉ tính ngày làm việc)', () => {
    const [b] = allocationBudgets(
      [A('u1', 'p1', 100, from, to), A('u1', 'p2', 100, '2026-10-24', '2026-10-25')],
      from,
      to,
    );
    expect(b!.peak.percent).toBe(100);
    expect(b!.overDays).toBe(0);
  });

  it('hai phân bổ cùng một dự án gộp thành một dòng; hoà đỉnh → ngày SỚM nhất', () => {
    const [b] = allocationBudgets(
      [
        A('u1', 'p1', 70, '2026-10-20', '2026-10-21'),
        A('u1', 'p1', 50, '2026-10-21', '2026-10-22'),
      ],
      from,
      to,
    );
    expect(b!.peak).toEqual({ percent: 120, day: '2026-10-21' });
    expect(b!.perProject).toEqual([{ projectId: 'p1', key: 'P1', name: 'Dự án p1', percent: 120 }]);
  });

  it('nhiều người: mỗi người một mục, sắp theo tên; người có đỉnh cao nhất không bị lẫn', () => {
    const out = allocationBudgets(
      [A('u2', 'p1', 40, from, to), A('u1', 'p1', 100, from, to), A('u1', 'p2', 30, from, to)],
      from,
      to,
    );
    expect(out.map((b) => b.userId)).toEqual(['u1', 'u2']);
    expect(out[0]!.peak.percent).toBe(130);
    expect(out[1]!.peak.percent).toBe(40);
  });

  it('phân bổ nằm ngoài khoảng → người đó không có mục; khoảng không có ngày làm việc → rỗng', () => {
    expect(allocationBudgets([A('u1', 'p1', 50, '2026-11-01', '2026-11-30')], from, to)).toEqual(
      [],
    );
    expect(allocationBudgets([A('u1', 'p1', 50, from, to)], '2026-10-24', '2026-10-25')).toEqual(
      [],
    );
  });

  it('ngày hỏng/đảo ngược trong dữ liệu không làm hỏng người khác', () => {
    const out = allocationBudgets(
      [
        A('u1', 'p1', 50, 'xx', 'yy'),
        A('u2', 'p1', 50, '2026-10-23', '2026-10-20'),
        A('u3', 'p1', 50, from, to),
      ],
      from,
      to,
    );
    expect(out.map((b) => b.userId)).toEqual(['u3']);
  });
});
