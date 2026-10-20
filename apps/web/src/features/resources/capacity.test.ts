import { describe, expect, it } from 'vitest';
import {
  availabilityHint,
  issueWeekStart,
  weekEndOf,
  weekStartOf,
  type CapacityCell,
} from './capacity';

describe('weekStartOf — tuần bắt đầu THỨ HAI (cùng định nghĩa với /resources/workload: startOfWeek ở date.util)', () => {
  it('thứ Hai → chính nó; giữa tuần và Chủ nhật → thứ Hai trước đó', () => {
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19'); // T2
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19'); // T4
    expect(weekStartOf('2026-10-23')).toBe('2026-10-19'); // T6
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19'); // CN thuộc tuần TRƯỚC (không sang tuần sau)
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26'); // T2 kế
  });
  it('qua ranh giới tháng/năm', () => {
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26'); // CN
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28'); // T6
  });
  it('weekEndOf = Chủ nhật của tuần', () => {
    expect(weekEndOf('2026-10-19')).toBe('2026-10-25');
  });
  it('đầu vào hỏng → null', () => {
    expect(weekStartOf('hôm qua')).toBeNull();
    expect(weekStartOf('')).toBeNull();
  });
});

describe('issueWeekStart — tuần của hạn, rồi ngày bắt đầu, rồi tuần hiện tại', () => {
  const today = '2026-10-20'; // T3
  it('ưu tiên hạn (dueDate)', () => {
    expect(issueWeekStart({ dueDate: '2026-11-04', startDate: '2026-10-21' }, today)).toBe(
      '2026-11-02',
    );
  });
  it('không có hạn → dùng ngày bắt đầu', () => {
    expect(issueWeekStart({ dueDate: null, startDate: '2026-10-28' }, today)).toBe('2026-10-26');
  });
  it('không có cả hai → tuần hiện tại', () => {
    expect(issueWeekStart({ dueDate: null, startDate: null }, today)).toBe('2026-10-19');
    expect(issueWeekStart({}, today)).toBe('2026-10-19');
  });
  it('ISO đầy đủ UTC lấy NGÀY UTC như máy chủ (toUtcDay), không lệch theo múi giờ trình duyệt', () => {
    expect(issueWeekStart({ dueDate: '2026-10-25T00:00:00.000Z' }, today)).toBe('2026-10-19'); // CN UTC
    expect(issueWeekStart({ dueDate: '2026-10-25T23:30:00.000Z' }, today)).toBe('2026-10-19');
    expect(issueWeekStart({ dueDate: '2026-10-26T00:00:00.000Z' }, today)).toBe('2026-10-26');
  });
  it('ngày hỏng → rơi về mốc kế tiếp', () => {
    expect(issueWeekStart({ dueDate: 'xx', startDate: '2026-10-21' }, today)).toBe('2026-10-19');
  });
});

describe('availabilityHint — "còn trống ~N giờ/tuần" / "quá tải ~N giờ"', () => {
  const cell = (over: Partial<CapacityCell>): CapacityCell => ({
    weekStart: '2026-10-19',
    capacityHours: 40,
    assignedHours: 34,
    workingDays: 5,
    offDays: 0,
    ...over,
  });
  it('còn trống: làm tròn giờ', () => {
    expect(availabilityHint(cell({}))).toEqual({
      kind: 'free',
      hours: 6,
      text: 'còn trống ~6 giờ/tuần',
    });
    expect(availabilityHint(cell({ assignedHours: 33.6 }))?.text).toBe('còn trống ~6 giờ/tuần');
    expect(availabilityHint(cell({ assignedHours: 0 }))?.text).toBe('còn trống ~40 giờ/tuần');
  });
  it('quá tải: số giờ vượt, làm tròn', () => {
    expect(availabilityHint(cell({ assignedHours: 46.4 }))).toEqual({
      kind: 'over',
      hours: 6,
      text: 'quá tải ~6 giờ',
    });
  });
  it('gần 0 (|dư| < 0,5 giờ) → "kín lịch", không "còn trống ~0"', () => {
    expect(availabilityHint(cell({ assignedHours: 39.8 }))).toEqual({
      kind: 'full',
      hours: 0,
      text: 'kín lịch',
    });
    expect(availabilityHint(cell({ assignedHours: 40.3 }))?.kind).toBe('full');
  });
  it('nghỉ cả tuần (không còn ngày làm việc) → "nghỉ cả tuần", không số giờ', () => {
    expect(
      availabilityHint(cell({ capacityHours: 0, assignedHours: 0, workingDays: 0, offDays: 5 })),
    ).toEqual({ kind: 'off', hours: 0, text: 'nghỉ cả tuần' });
  });
  it('không có năng lực mà vẫn bị giao việc (phân bổ 0%) → quá tải theo số giờ được giao', () => {
    expect(
      availabilityHint(cell({ capacityHours: 0, assignedHours: 8, workingDays: 5, offDays: 0 })),
    ).toEqual({
      kind: 'over',
      hours: 8,
      text: 'quá tải ~8 giờ',
    });
  });
  it('thiếu dữ liệu / NaN → null (không hiện gì)', () => {
    expect(availabilityHint(undefined)).toBeNull();
    expect(availabilityHint(cell({ capacityHours: Number.NaN }))).toBeNull();
  });
});
