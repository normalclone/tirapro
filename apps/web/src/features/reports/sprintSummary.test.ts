import { describe, expect, it } from 'vitest';
import { completionPct, fmtPoints, movedToLabel, velocityVerdict } from './sprintSummary';

describe('completionPct', () => {
  it('kẹp 0..100 và an toàn khi committed = 0', () => {
    expect(completionPct(18, 24)).toBe(75);
    expect(completionPct(0, 0)).toBe(0);
    expect(completionPct(30, 24)).toBe(100);
    expect(completionPct(-3, 24)).toBe(0);
  });

  it('làm tròn tới số nguyên gần nhất', () => {
    expect(completionPct(1, 3)).toBe(33);
    expect(completionPct(2, 3)).toBe(67);
  });
});

describe('fmtPoints', () => {
  it('số nguyên giữ nguyên, số lẻ lấy tối đa 1 chữ số thập phân', () => {
    expect(fmtPoints(18)).toBe('18');
    expect(fmtPoints(2.5)).toBe('2,5');
    expect(fmtPoints(2.25)).toBe('2,3');
    expect(fmtPoints(0)).toBe('0');
  });
});

describe('velocityVerdict', () => {
  it('thấp hơn / cao hơn / bằng velocity TB', () => {
    expect(velocityVerdict(-10).text).toBe('Thấp hơn velocity TB 10%');
    expect(velocityVerdict(25).text).toBe('Cao hơn velocity TB 25%');
    expect(velocityVerdict(0).text).toBe('Bằng velocity TB');
  });

  it('làm tròn: lệch dưới 0,5% coi như bằng', () => {
    expect(velocityVerdict(0.4).text).toBe('Bằng velocity TB');
    expect(velocityVerdict(-9.6).text).toBe('Thấp hơn velocity TB 10%');
  });

  it('chưa có velocity TB để so', () => {
    expect(velocityVerdict(null).text).toBe('Chưa có velocity TB để so');
  });

  it('tone: tốt khi cao hơn, cảnh báo khi thấp hơn, trung tính còn lại', () => {
    expect(velocityVerdict(10).tone).toBe('good');
    expect(velocityVerdict(-10).tone).toBe('warn');
    expect(velocityVerdict(0).tone).toBe('neutral');
    expect(velocityVerdict(null).tone).toBe('neutral');
  });
});

describe('movedToLabel', () => {
  it('backlog → "Việc chờ"', () => {
    expect(movedToLabel({ kind: 'backlog' })).toBe('Việc chờ');
  });

  it('sprint có sẵn → tên sprint trong ngoặc kép cong', () => {
    expect(movedToLabel({ kind: 'sprint', sprintId: 's3', sprintName: 'Sprint 3' })).toBe(
      '“Sprint 3”',
    );
  });

  it('sprint mới tạo kèm ghi chú', () => {
    expect(movedToLabel({ kind: 'new', sprintId: 's3', sprintName: 'Sprint 3' })).toBe(
      '“Sprint 3” (mới tạo)',
    );
  });

  it('thiếu tên (sprint đích đã bị xoá) → vẫn có câu chữ rõ nghĩa', () => {
    expect(movedToLabel({ kind: 'sprint', sprintId: 'x' })).toBe('một sprint khác');
  });

  it('null (sprint đóng trước khi lưu danh sách chuyển tiếp) → null', () => {
    expect(movedToLabel(null)).toBeNull();
  });
});
