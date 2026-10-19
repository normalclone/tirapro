import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sprintTimeInfo } from './sprintTime';

const now = new Date(2026, 9, 15, 10); // 15/10/2026 10:00 giờ địa phương
const active = (endDate: string | null, startDate: string | null = '2026-10-01T00:00:00.000Z') =>
  ({ state: 'ACTIVE', startDate, endDate }) as const;

describe('sprintTimeInfo', () => {
  it('còn 14 ngày', () =>
    expect(
      sprintTimeInfo(
        {
          state: 'ACTIVE',
          startDate: '2026-10-15T00:00:00.000Z',
          endDate: '2026-10-29T00:00:00.000Z',
        },
        now,
      ),
    ).toMatchObject({ daysLeft: 14, label: 'còn 14 ngày', range: '15/10 – 29/10', tone: 'muted' }));

  it('hết hôm nay (warning), còn 2 ngày (warning), còn 3 ngày (muted)', () => {
    expect(sprintTimeInfo(active('2026-10-15T00:00:00.000Z'), now)).toMatchObject({
      daysLeft: 0,
      label: 'hết hôm nay',
      tone: 'warning',
    });
    expect(sprintTimeInfo(active('2026-10-17T00:00:00.000Z'), now)).toMatchObject({
      daysLeft: 2,
      label: 'còn 2 ngày',
      tone: 'warning',
    });
    expect(sprintTimeInfo(active('2026-10-18T00:00:00.000Z'), now)).toMatchObject({
      daysLeft: 3,
      tone: 'muted',
    });
  });

  it('trễ N ngày (danger)', () =>
    expect(sprintTimeInfo(active('2026-10-12T00:00:00.000Z'), now)).toMatchObject({
      daysLeft: -3,
      label: 'trễ 3 ngày',
      tone: 'danger',
    }));

  it('chưa đặt ngày kết thúc (warning), range chỉ có khi đủ ngày', () => {
    expect(sprintTimeInfo(active(null), now)).toMatchObject({
      daysLeft: null,
      label: 'chưa đặt ngày kết thúc',
      range: null,
      tone: 'warning',
    });
    expect(sprintTimeInfo(active('2026-10-29T00:00:00.000Z', null), now).range).toBe('đến 29/10');
  });

  it('FUTURE/CLOSED không có nhãn đếm ngược', () => {
    expect(
      sprintTimeInfo(
        {
          state: 'CLOSED',
          startDate: '2026-09-01T00:00:00.000Z',
          endDate: '2026-09-14T00:00:00.000Z',
        },
        now,
      ),
    ).toMatchObject({
      label: 'đã kết thúc',
      daysLeft: null,
      tone: 'muted',
      range: '01/09 – 14/09',
    });
    expect(sprintTimeInfo({ state: 'FUTURE', startDate: null, endDate: null }, now)).toMatchObject({
      label: 'chưa bắt đầu',
      daysLeft: null,
      range: null,
    });
  });

  it('ngày khác năm hiện tại hiện đủ năm', () =>
    expect(
      sprintTimeInfo(
        {
          state: 'ACTIVE',
          startDate: '2026-12-28T00:00:00.000Z',
          endDate: '2027-01-08T00:00:00.000Z',
        },
        now,
      ).range,
    ).toBe('28/12/2026 – 08/01/2027'));

  it('coi ngày kết thúc là ngày lịch, không lệch theo múi giờ (23:59 UTC vẫn là ngày đó)', () =>
    expect(
      sprintTimeInfo(active('2026-10-20T00:00:00.000Z'), new Date(2026, 9, 15, 23, 59)).daysLeft,
    ).toBe(5));
});

describe('sprintTime định dạng ngày qua dateFormat', () => {
  it('không tự `format()` dd/MM bằng date-fns (một nguồn: fmtDayMonth/fmtDate)', () => {
    const src = readFileSync(join(__dirname, 'sprintTime.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/dateFormat'/);
    expect(src).not.toMatch(/format\(calendarDate/);
    expect(src).not.toMatch(/import \{[^}]*\bformat\b[^}]*\} from 'date-fns'/);
  });
});
