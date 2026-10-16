import { describe, expect, it } from 'vitest';
import { goalPaceText, overloadDetailText, ratioText, riskMetaText } from './leadershipText';

describe('ratioText', () => {
  it('tỉ số → phần trăm làm tròn', () => {
    expect(ratioText(3.1)).toBe('310%');
    expect(ratioText(1.126)).toBe('113%');
  });
});

describe('riskMetaText', () => {
  it('khoá dự án + hạn dd/MM/yyyy; thiếu phần nào bỏ phần đó', () => {
    expect(
      riskMetaText({ project: { key: 'DEMO', name: 'Demo' }, dueDate: '2026-12-01T00:00:00.000Z' }),
    ).toBe('DEMO · Hạn 01/12/2026');
    expect(riskMetaText({ project: null, dueDate: null })).toBe('');
    expect(riskMetaText({ project: { key: 'X', name: 'x' }, dueDate: null })).toBe('X');
  });
});

describe('goalPaceText', () => {
  it('nêu cả tiến độ thật, mốc thời gian và kỳ', () => {
    expect(goalPaceText({ progress: 10, expectedProgress: 51, period: '2026-Q4' })).toBe(
      '10% · đáng ra ~51% (2026-Q4)',
    );
  });
});

describe('overloadDetailText', () => {
  it('giờ giao/năng lực + tuần; số lẻ dùng dấu phẩy', () => {
    expect(
      overloadDetailText({ assignedHours: 124, capacityHours: 40, weekLabel: '23/11 – 29/11' }),
    ).toBe('124/40 giờ · 23/11 – 29/11');
    expect(overloadDetailText({ assignedHours: 42.5, capacityHours: 32, weekLabel: 'a' })).toBe(
      '42,5/32 giờ · a',
    );
  });
});
