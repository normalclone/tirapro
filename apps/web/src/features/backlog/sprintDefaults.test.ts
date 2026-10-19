import { describe, expect, it } from 'vitest';
import {
  dayOf,
  defaultStart,
  startRangeError,
  startWarnings,
  suggestEnd,
  toDayIso,
} from './sprintDefaults';

describe('suggestEnd', () => {
  it('cộng đúng số tuần, giữ định dạng ISO UTC 00:00', () => {
    expect(suggestEnd('2026-10-15T00:00:00.000Z', 2)).toBe('2026-10-29T00:00:00.000Z');
    expect(suggestEnd('2026-10-15T00:00:00.000Z', 1)).toBe('2026-10-22T00:00:00.000Z');
    expect(suggestEnd('2026-10-15T00:00:00.000Z', 3)).toBe('2026-11-05T00:00:00.000Z');
  });

  it('qua cuối tháng/năm vẫn đúng', () => {
    expect(suggestEnd('2026-12-25T00:00:00.000Z', 2)).toBe('2027-01-08T00:00:00.000Z');
  });
});

describe('defaultStart', () => {
  it('hôm nay theo ngày địa phương, ISO UTC 00:00 (không lệch ngày)', () => {
    // 23:30 giờ địa phương vẫn là ngày hôm đó, dù đổi sang UTC có thể sang ngày khác.
    expect(defaultStart(new Date(2026, 9, 15, 23, 30))).toBe('2026-10-15T00:00:00.000Z');
    expect(defaultStart(new Date(2026, 9, 15, 0, 5))).toBe('2026-10-15T00:00:00.000Z');
  });
});

describe('dayOf / toDayIso', () => {
  it('đổi qua lại giữa ISO và ngày yyyy-MM-dd', () => {
    expect(dayOf('2026-10-29T00:00:00.000Z')).toBe('2026-10-29');
    expect(dayOf(null)).toBe('');
    expect(toDayIso('2026-10-29')).toBe('2026-10-29T00:00:00.000Z');
  });
});

describe('startWarnings', () => {
  it('thiếu hết → đủ 3 cảnh báo theo thứ tự cố định: ngày kết thúc, mục tiêu, việc', () => {
    const w = startWarnings({ issueCount: 0, totalPoints: 0, hasGoal: false, hasEnd: false });
    expect(w).toEqual([
      'Chưa có ngày kết thúc — burndown và “còn N ngày” sẽ trống.',
      'Chưa có mục tiêu sprint.',
      'Sprint chưa có việc nào.',
    ]);
  });

  it('đủ ngày, mục tiêu, việc có điểm → không cảnh báo', () => {
    expect(startWarnings({ issueCount: 3, totalPoints: 8, hasGoal: true, hasEnd: true })).toEqual(
      [],
    );
  });

  it('có việc chưa ước lượng điểm → nêu số lượng', () => {
    expect(
      startWarnings({
        issueCount: 5,
        totalPoints: 8,
        hasGoal: true,
        hasEnd: true,
        unestimatedCount: 2,
      }),
    ).toEqual(['Có việc chưa ước lượng điểm: 2.']);
  });

  it('không biết số việc chưa ước lượng: tổng điểm 0 nghĩa là cả sprint chưa ước lượng', () => {
    expect(startWarnings({ issueCount: 4, totalPoints: 0, hasGoal: true, hasEnd: true })).toEqual([
      'Có việc chưa ước lượng điểm: 4.',
    ]);
  });

  it('sprint trống thì không nhắc "chưa ước lượng" (đã có cảnh báo trống)', () => {
    const w = startWarnings({
      issueCount: 0,
      totalPoints: 0,
      hasGoal: true,
      hasEnd: true,
      unestimatedCount: 0,
    });
    expect(w).toEqual(['Sprint chưa có việc nào.']);
  });
});

describe('startRangeError', () => {
  it('kết thúc trước bắt đầu → lỗi, nói "không được trước"', () => {
    expect(startRangeError('2026-10-15', '2026-10-10')).toBe(
      'Ngày kết thúc không được trước ngày bắt đầu.',
    );
  });

  it('bằng nhau hoặc sau → hợp lệ (khớp luật máy chủ: cho phép bằng nhau)', () => {
    expect(startRangeError('2026-10-15', '2026-10-15')).toBeNull();
    expect(startRangeError('2026-10-15', '2026-10-29')).toBeNull();
  });

  it('thiếu một trong hai ngày → không báo lỗi', () => {
    expect(startRangeError('', '2026-10-10')).toBeNull();
    expect(startRangeError('2026-10-15', '')).toBeNull();
  });
});
