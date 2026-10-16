import { describe, expect, it } from 'vitest';
import { isDue, isValidTimeZone, localParts, sameLocalHour } from './digest-schedule';

const VN = 'Asia/Ho_Chi_Minh';

describe('isDue', () => {
  it('WEEKLY thứ Hai 08:00 giờ VN: 08:30 ICT thứ Hai đến hạn; 09:30 ICT thì không; thứ Ba không', () => {
    const sub = { schedule: 'WEEKLY', weekday: 1, hour: 8, timezone: VN } as const;
    expect(isDue(sub, new Date('2026-10-19T01:30:00Z'))).toBe(true);
    expect(isDue(sub, new Date('2026-10-19T02:30:00Z'))).toBe(false);
    expect(isDue(sub, new Date('2026-10-20T01:30:00Z'))).toBe(false);
  });

  it('WEEKLY dùng ngày địa phương, không phải UTC: 22:00 UTC Chủ nhật = 05:00 thứ Hai ICT', () => {
    const sub = { schedule: 'WEEKLY', weekday: 1, hour: 5, timezone: VN } as const;
    expect(isDue(sub, new Date('2026-10-18T22:10:00Z'))).toBe(true);
    expect(isDue({ ...sub, weekday: 0 }, new Date('2026-10-18T22:10:00Z'))).toBe(false);
  });

  it('DAILY bỏ qua weekday, chỉ xét giờ', () => {
    const sub = { schedule: 'DAILY', weekday: 3, hour: 8, timezone: VN } as const;
    expect(isDue(sub, new Date('2026-10-19T01:00:00Z'))).toBe(true);
    expect(isDue(sub, new Date('2026-10-23T01:59:00Z'))).toBe(true);
    expect(isDue(sub, new Date('2026-10-19T02:00:00Z'))).toBe(false);
  });

  it('múi giờ có DST (America/New_York): theo giờ địa phương trước/sau khi đổi giờ', () => {
    const sub = { schedule: 'DAILY', weekday: 1, hour: 8, timezone: 'America/New_York' } as const;
    // Trước DST kết thúc (EDT = UTC-4): 08:00 địa phương = 12:00Z.
    expect(isDue(sub, new Date('2026-10-31T12:30:00Z'))).toBe(true);
    expect(isDue(sub, new Date('2026-10-31T13:30:00Z'))).toBe(false);
    // Sau khi kết thúc DST 2026-11-01 (EST = UTC-5): 08:00 địa phương = 13:00Z.
    expect(isDue(sub, new Date('2026-11-02T13:30:00Z'))).toBe(true);
    expect(isDue(sub, new Date('2026-11-02T12:30:00Z'))).toBe(false);
  });

  it('múi giờ lệch 30 phút (Asia/Kolkata) vẫn rơi đúng một lần trong giờ đã chọn', () => {
    const sub = { schedule: 'DAILY', weekday: 1, hour: 8, timezone: 'Asia/Kolkata' } as const;
    // 08:00–08:59 IST = 02:30Z–03:29Z
    expect(isDue(sub, new Date('2026-10-19T02:35:00Z'))).toBe(true);
    expect(isDue(sub, new Date('2026-10-19T03:25:00Z'))).toBe(true);
    expect(isDue(sub, new Date('2026-10-19T03:35:00Z'))).toBe(false);
  });

  it('SPRINT_END/MANUAL không bao giờ "đến hạn" ở cron', () => {
    for (const schedule of ['SPRINT_END', 'MANUAL'] as const) {
      const sub = { schedule, weekday: 1, hour: 8, timezone: VN };
      expect(isDue(sub, new Date('2026-10-19T01:30:00Z'))).toBe(false);
    }
  });

  it('múi giờ lạ không làm cron ném lỗi — coi như không đến hạn', () => {
    const sub = { schedule: 'DAILY', weekday: 1, hour: 8, timezone: 'Mars/Base' } as const;
    expect(isDue(sub, new Date('2026-10-19T01:30:00Z'))).toBe(false);
  });
});

describe('localParts', () => {
  it('trả thứ (0=CN), giờ 0–23 (không có 24) và khoá ngày địa phương', () => {
    expect(localParts(new Date('2026-10-18T17:05:00Z'), VN)).toMatchObject({
      weekday: 1,
      hour: 0,
      day: '2026-10-19',
    });
    expect(localParts(new Date('2026-10-18T05:00:00Z'), VN)).toMatchObject({
      weekday: 0,
      hour: 12,
    });
  });
});

describe('sameLocalHour', () => {
  it('cùng ngày + cùng giờ địa phương → true; giờ khác/ngày khác → false', () => {
    expect(
      sameLocalHour(new Date('2026-10-19T01:05:00Z'), new Date('2026-10-19T01:50:00Z'), VN),
    ).toBe(true);
    expect(
      sameLocalHour(new Date('2026-10-19T01:50:00Z'), new Date('2026-10-19T02:05:00Z'), VN),
    ).toBe(false);
    expect(
      sameLocalHour(new Date('2026-10-18T01:30:00Z'), new Date('2026-10-19T01:30:00Z'), VN),
    ).toBe(false);
  });
});

describe('isValidTimeZone', () => {
  it('nhận IANA hợp lệ, từ chối giá trị lạ/rỗng', () => {
    expect(isValidTimeZone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
