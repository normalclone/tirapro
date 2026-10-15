import { describe, expect, it } from 'vitest';
import { computeProjectHealth, type ProjectHealthInput } from './project-health';

const base: ProjectHealthInput = {
  total: 10,
  open: 6,
  overdue: 0,
  activeSprint: null,
  openRisks: [],
  lastResolvedAt: new Date('2026-10-14'),
  now: new Date('2026-10-15'),
};
const sprint = (over: Partial<NonNullable<ProjectHealthInput['activeSprint']>> = {}) => ({
  name: 'Sprint 2',
  endDate: new Date('2026-10-20T00:00:00Z'),
  remainingPoints: 2,
  committedPoints: 24,
  ...over,
});

describe('computeProjectHealth', () => {
  it('NONE khi chưa có công việc', () =>
    expect(computeProjectHealth({ ...base, total: 0, open: 0 }).level).toBe('NONE'));

  it('GREEN khi không dấu hiệu xấu, không có lý do', () =>
    expect(computeProjectHealth(base)).toEqual({ level: 'GREEN', reasons: [] }));

  it('GREEN khi đã xong hết việc dù lâu rồi không có việc hoàn tất', () =>
    expect(
      computeProjectHealth({ ...base, open: 0, lastResolvedAt: new Date('2026-08-01') }).level,
    ).toBe('GREEN'));

  it('YELLOW khi có việc quá hạn (<25%)', () =>
    expect(computeProjectHealth({ ...base, open: 8, overdue: 1 })).toMatchObject({
      level: 'YELLOW',
      reasons: [expect.stringContaining('1/8')],
    }));

  it('RED khi quá hạn ≥25% số việc mở và ≥2 việc; 1 việc quá hạn dù 100% chỉ là YELLOW', () => {
    expect(computeProjectHealth({ ...base, overdue: 2 })).toMatchObject({
      level: 'RED',
      reasons: [expect.stringContaining('2/6')],
    });
    expect(computeProjectHealth({ ...base, open: 1, overdue: 1 }).level).toBe('YELLOW');
    expect(computeProjectHealth({ ...base, open: 20, overdue: 4 }).level).toBe('YELLOW'); // 20%
    expect(computeProjectHealth({ ...base, open: 20, overdue: 5 }).level).toBe('RED'); // 25%
  });

  it('RED khi sprint đang chạy đã quá hạn mà còn điểm; hết điểm thì không', () => {
    const late = computeProjectHealth({
      ...base,
      activeSprint: sprint({ endDate: new Date('2026-10-13T00:00:00Z'), remainingPoints: 8 }),
    });
    expect(late.level).toBe('RED');
    expect(late.reasons[0]).toBe('Sprint 2 trễ 2 ngày, còn 8 điểm');
    expect(
      computeProjectHealth({
        ...base,
        activeSprint: sprint({ endDate: new Date('2026-10-13T00:00:00Z'), remainingPoints: 0 }),
      }).level,
    ).toBe('GREEN');
  });

  it('YELLOW khi sprint còn ≤2 ngày mà còn ≥40% điểm cam kết; còn 3 ngày hoặc <40% thì không', () => {
    const near = computeProjectHealth({
      ...base,
      activeSprint: sprint({ endDate: new Date('2026-10-17T00:00:00Z'), remainingPoints: 10 }),
    });
    expect(near.level).toBe('YELLOW');
    expect(near.reasons[0]).toBe('Sprint 2 còn 2 ngày, còn 10/24 điểm chưa xong');
    expect(
      computeProjectHealth({
        ...base,
        activeSprint: sprint({ endDate: new Date('2026-10-18T00:00:00Z'), remainingPoints: 24 }),
      }).level,
    ).toBe('GREEN');
    expect(
      computeProjectHealth({
        ...base,
        activeSprint: sprint({ endDate: new Date('2026-10-17T00:00:00Z'), remainingPoints: 9 }),
      }).level,
    ).toBe('GREEN');
  });

  it('sprint không có ngày kết thúc hoặc không có điểm cam kết => không ảnh hưởng', () => {
    expect(computeProjectHealth({ ...base, activeSprint: sprint({ endDate: null }) }).level).toBe(
      'GREEN',
    );
    expect(
      computeProjectHealth({
        ...base,
        activeSprint: sprint({ endDate: new Date('2026-10-16T00:00:00Z'), committedPoints: 0 }),
      }).level,
    ).toBe('GREEN');
  });

  it('RED khi có rủi ro mở điểm ≥20; YELLOW khi 13–19; dưới 13 thì không', () => {
    const risk = (probability: number, impact: number) => ({
      title: 'Mất người chủ chốt',
      probability,
      impact,
    });
    const critical = computeProjectHealth({ ...base, openRisks: [risk(5, 4)] });
    expect(critical.level).toBe('RED');
    expect(critical.reasons[0]).toBe("Rủi ro 'Mất người chủ chốt' mức Nghiêm trọng");
    const high = computeProjectHealth({ ...base, openRisks: [risk(4, 4)] });
    expect(high.level).toBe('YELLOW');
    expect(high.reasons[0]).toBe("Rủi ro 'Mất người chủ chốt' mức Cao");
    expect(computeProjectHealth({ ...base, openRisks: [risk(3, 4)] }).level).toBe('GREEN');
  });

  it('YELLOW khi 14 ngày không việc nào xong mà còn việc mở; chưa từng xong cũng tính', () => {
    expect(computeProjectHealth({ ...base, lastResolvedAt: new Date('2026-10-01') })).toMatchObject(
      { level: 'YELLOW', reasons: [expect.stringContaining('14 ngày')] },
    );
    expect(computeProjectHealth({ ...base, lastResolvedAt: new Date('2026-10-02') }).level).toBe(
      'GREEN',
    );
    expect(computeProjectHealth({ ...base, lastResolvedAt: null }).level).toBe('YELLOW');
  });

  it('dự án mới tạo chưa tới 14 ngày không bị coi là "đình trệ"', () => {
    expect(
      computeProjectHealth({
        ...base,
        lastResolvedAt: null,
        createdAt: new Date('2026-10-10'),
      }).level,
    ).toBe('GREEN');
  });

  it('nhiều dấu hiệu: mức cao nhất thắng, mọi lý do đều được liệt kê (đỏ trước vàng)', () => {
    const r = computeProjectHealth({
      ...base,
      overdue: 2,
      lastResolvedAt: null,
      openRisks: [{ title: 'X', probability: 4, impact: 4 }],
    });
    expect(r.level).toBe('RED');
    expect(r.reasons).toHaveLength(3);
    expect(r.reasons[0]).toContain('2/6');
  });
});
