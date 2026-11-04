import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POINTS_FORMULA as F,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  computePoints,
  defaultDueDate,
  explainPoints,
  pointsFormulaSchema,
  type PointsFormula,
} from './points';

describe('computePoints', () => {
  it('Bug · Khó · High = 2×3×1.5 = 9', () => {
    expect(computePoints(F, 'BUG', 'HARD', 'High')).toBe(9);
  });
  it('Task · Dễ · Medium = 2', () => {
    expect(computePoints(F, 'TASK', 'EASY', 'Medium')).toBe(2);
  });
  it('loại tuỳ chỉnh (key null) dùng điểm gốc của Task', () => {
    expect(computePoints(F, null, 'MEDIUM', null)).toBe(4);
  });
  it('Epic trả null (tổng điểm việc con, không áp công thức)', () => {
    expect(computePoints(F, 'EPIC', 'MEDIUM', 'High')).toBeNull();
  });
  it('làm tròn half-up: 1×1×1.5 = 1.5 → 2', () => {
    const f: PointsFormula = {
      base: { SUBTASK: 1, TASK: 1, BUG: 1, STORY: 1 },
      difficulty: { EASY: 1, MEDIUM: 1, HARD: 1, VERY_HARD: 1 },
      priority: { Lowest: 1, Low: 1, Medium: 1, High: 1.5, Highest: 1.5 },
    };
    expect(computePoints(f, 'TASK', 'EASY', 'High')).toBe(2);
  });
  it('ưu tiên lạ hoặc không có ưu tiên: hệ số ×1', () => {
    expect(computePoints(F, 'STORY', 'EASY', 'Khẩn cấp')).toBe(3);
    expect(computePoints(F, 'STORY', 'EASY', null)).toBe(3);
  });
  it('không bị prototype chen vào tên ưu tiên ("constructor", "toString")', () => {
    expect(computePoints(F, 'TASK', 'EASY', 'constructor')).toBe(2);
    expect(computePoints(F, 'TASK', 'EASY', 'toString')).toBe(2);
  });
  it('hệ số mặc định đúng spec', () => {
    expect(F.base).toEqual({ SUBTASK: 1, TASK: 2, BUG: 2, STORY: 3 });
    expect(F.difficulty).toEqual({ EASY: 1, MEDIUM: 2, HARD: 3, VERY_HARD: 5 });
    expect(F.priority).toEqual({ Lowest: 1, Low: 1, Medium: 1, High: 1.5, Highest: 2 });
  });
});

describe('explainPoints', () => {
  it('ghi rõ cách ra con số', () => {
    expect(explainPoints(F, 'BUG', 'Bug', 'HARD', 'High')).toBe('Bug · Khó · High = 2×3×1.5 = 9');
  });
  it('Epic: giải thích là tổng việc con', () => {
    expect(explainPoints(F, 'EPIC', 'Epic', 'MEDIUM', 'High')).toBe(
      'Epic = tổng điểm các việc con',
    );
  });
  it('không có ưu tiên: bỏ đoạn ưu tiên, hệ số ×1', () => {
    expect(explainPoints(F, 'TASK', 'Task', 'MEDIUM', null)).toBe('Task · Trung bình = 2×2×1 = 4');
  });
});

describe('labels', () => {
  it('đủ 4 mức độ khó theo thứ tự', () => {
    expect(DIFFICULTIES).toEqual(['EASY', 'MEDIUM', 'HARD', 'VERY_HARD']);
    expect(DIFFICULTIES.map((d) => DIFFICULTY_LABELS[d])).toEqual([
      'Dễ',
      'Trung bình',
      'Khó',
      'Rất khó',
    ]);
  });
});

describe('pointsFormulaSchema', () => {
  it('chấp nhận bảng mặc định', () => {
    expect(pointsFormulaSchema.safeParse(F).success).toBe(true);
  });
  it('từ chối 0, số âm, > 100, thiếu khoá', () => {
    const bad = (mut: (f: PointsFormula) => void) => {
      const c = structuredClone(F);
      mut(c);
      return pointsFormulaSchema.safeParse(c).success;
    };
    expect(bad((f) => (f.base.BUG = 0))).toBe(false);
    expect(bad((f) => (f.difficulty.HARD = -1))).toBe(false);
    expect(bad((f) => (f.priority.High = 100.5))).toBe(false);
    expect(bad((f) => (f.priority.High = 100))).toBe(true);
    expect(pointsFormulaSchema.safeParse({ ...F, base: { TASK: 2 } }).success).toBe(false);
  });
});

describe('defaultDueDate (ngày lịch Việt Nam + 1)', () => {
  it('23:30 giờ VN (16:30 UTC) vẫn là ngày VN 04/11 → hạn 05/11', () => {
    expect(defaultDueDate(new Date('2026-11-04T16:30:00Z'))).toBe('2026-11-05T00:00:00.000Z');
  });
  it('00:30 giờ VN ngày 05/11 (17:30 UTC ngày 04/11) đã sang ngày VN kế tiếp → hạn 06/11, không phải ngày UTC + 1', () => {
    expect(defaultDueDate(new Date('2026-11-04T17:30:00Z'))).toBe('2026-11-06T00:00:00.000Z');
  });
  it('giữa ngày VN', () => {
    expect(defaultDueDate(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-05T00:00:00.000Z');
  });
  it('biên: 16:59:59 UTC còn ngày VN cũ, 17:00:00 UTC sang ngày VN mới', () => {
    expect(defaultDueDate(new Date('2026-11-04T16:59:59Z'))).toBe('2026-11-05T00:00:00.000Z');
    expect(defaultDueDate(new Date('2026-11-04T17:00:00Z'))).toBe('2026-11-06T00:00:00.000Z');
  });
  it('qua tháng/năm', () => {
    expect(defaultDueDate(new Date('2026-12-31T10:00:00Z'))).toBe('2027-01-01T00:00:00.000Z');
    expect(defaultDueDate(new Date('2026-12-31T18:00:00Z'))).toBe('2027-01-02T00:00:00.000Z');
  });
});
