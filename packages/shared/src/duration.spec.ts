import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from './duration';

describe('parseDuration', () => {
  const table: Array<[string, number | null]> = [
    ['2h 30m', 9000],
    ['2h30m', 9000],
    ['1d', 28800],
    ['90m', 5400],
    ['1.5h', 5400],
    ['1w', 144000],
    ['1d 2h 15m', 28800 + 7200 + 900],
    ['  3H  ', 10800],
    ['45s', 45],
    ['abc', null],
    ['', null],
    ['2h abc', null],
    ['90', null],
    ['-1h', null],
    ['1h 1.5.2m', null],
    ['3650d', 3650 * 28800],
    ['99999999999h', null],
    ['100000d', null],
  ];
  it.each(table)('"%s" → %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('tôn trọng hoursPerDay tuỳ chỉnh', () => {
    expect(parseDuration('1d', { hoursPerDay: 6 })).toBe(21600);
    expect(parseDuration('1w', { hoursPerDay: 6, daysPerWeek: 4 })).toBe(86400);
  });
});

describe('formatDuration', () => {
  const table: Array<[number, string]> = [
    [9000, '2h 30m'],
    [28800, '8h'],
    [5400, '1h 30m'],
    [60, '1m'],
    [0, '0m'],
    [30, '1m'], // làm tròn lên phút để không hiện "0m" cho thời gian có thật
    [90000, '25h'],
  ];
  it.each(table)('%s giây → "%s"', (sec, expected) => {
    expect(formatDuration(sec)).toBe(expected);
  });

  it('parse(format(x)) khớp với phút tròn', () => {
    expect(parseDuration(formatDuration(12600))).toBe(12600);
  });
});
