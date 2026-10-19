import { describe, expect, it } from 'vitest';
import type { ProjectHealthDto } from '@tirapro/shared';
import { healthAutoText, healthLabel, healthReasonText, healthSummaryText } from './healthLabel';

const auto = { level: 'YELLOW', reasons: ['3/9 việc chưa xong đang quá hạn'] } as const;

describe('healthLabel', () => {
  it('nhãn tiếng Việt cho 4 mức', () => {
    expect(healthLabel('GREEN')).toBe('Tốt');
    expect(healthLabel('YELLOW')).toBe('Cần chú ý');
    expect(healthLabel('RED')).toBe('Nguy cơ');
    expect(healthLabel('NONE')).toBe('Chưa đủ dữ liệu');
  });
});

describe('healthSummaryText', () => {
  it('ưu tiên ghi đè + hiện cả phần tự tính', () => {
    const dto: ProjectHealthDto = {
      level: 'RED',
      auto: { level: auto.level, reasons: [...auto.reasons] },
      override: {
        level: 'RED',
        note: 'Chờ khách duyệt',
        updatedAt: '2026-10-13T00:00:00.000Z',
        updatedBy: { id: 'u1', displayName: 'Minh' },
      },
    };
    const text = healthSummaryText(dto);
    expect(text).toContain('Nguy cơ (ghi đè): Chờ khách duyệt');
    expect(text).toContain('Tự tính: Cần chú ý — 3/9 việc chưa xong đang quá hạn');
  });

  it('không ghi đè → mức + lý do tự tính; không lý do → chỉ mức; null → chưa đủ dữ liệu', () => {
    expect(
      healthSummaryText({
        level: 'YELLOW',
        auto: { level: 'YELLOW', reasons: ['a', 'b'] },
        override: null,
      }),
    ).toBe('Cần chú ý — a; b');
    expect(
      healthSummaryText({ level: 'GREEN', auto: { level: 'GREEN', reasons: [] }, override: null }),
    ).toBe('Tốt');
    expect(healthSummaryText(null)).toBe('Chưa đủ dữ liệu');
  });

  it('healthAutoText', () => {
    expect(healthAutoText({ level: 'NONE', reasons: [] })).toBe('Tự tính: Chưa đủ dữ liệu');
  });
});

describe('healthReasonText', () => {
  it('ghi đè → ghi chú PM + lý do tự tính; không ghi đè → lý do tự tính; null → rỗng', () => {
    expect(
      healthReasonText({
        level: 'RED',
        auto: { level: 'YELLOW', reasons: ['a'] },
        override: {
          level: 'RED',
          note: 'Chờ khách',
          updatedAt: '2026-10-13T00:00:00.000Z',
          updatedBy: null,
        },
      }),
    ).toBe('Ghi đè: Chờ khách | Tự tính: a');
    expect(
      healthReasonText({
        level: 'YELLOW',
        auto: { level: 'YELLOW', reasons: ['a', 'b'] },
        override: null,
      }),
    ).toBe('a; b');
    expect(healthReasonText(null)).toBe('');
  });
});
