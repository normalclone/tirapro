import { describe, expect, it } from 'vitest';
import { bulletDelta, bulletGeometry, bulletValueText, fmtNum } from './bullet';

describe('fmtNum', () => {
  it('làm tròn 1 chữ số, bỏ ".0"; không hữu hạn → 0', () => {
    expect(fmtNum(34)).toBe('34');
    expect(fmtNum(33.96)).toBe('34');
    expect(fmtNum(12.34)).toBe('12.3');
    expect(fmtNum(Number.NaN)).toBe('0');
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('bulletGeometry', () => {
  it('có max: thanh = value/max, vạch = target/max', () => {
    expect(bulletGeometry({ value: 30, target: 40, max: 100 })).toMatchObject({
      max: 100,
      now: 30,
      fillPct: 30,
      targetPct: 40,
    });
  });
  it('không có max: thang = lớn nhất của value/target/marker (vượt đích vẫn nằm trong thanh)', () => {
    const g = bulletGeometry({ value: 50, target: 40 });
    expect(g.max).toBe(50);
    expect(g.fillPct).toBe(100);
    expect(g.targetPct).toBe(80);
    expect(bulletGeometry({ value: 10, target: 40 })).toMatchObject({
      max: 40,
      fillPct: 25,
      targetPct: 100,
    });
    expect(bulletGeometry({ value: 10, target: 40, markers: [{ at: 80, label: 'x' }] }).max).toBe(
      80,
    );
  });
  it('kẹp 0..100 và giá trị ARIA hợp lệ (now ≤ max) khi value vượt max/âm/NaN', () => {
    expect(bulletGeometry({ value: 150, target: 120, max: 100 })).toMatchObject({
      now: 100,
      fillPct: 100,
      targetPct: 100,
    });
    expect(bulletGeometry({ value: -5, max: 100 })).toMatchObject({ now: 0, fillPct: 0 });
    expect(bulletGeometry({ value: Number.NaN, max: 100 })).toMatchObject({ now: 0, fillPct: 0 });
    expect(bulletGeometry({ value: 5, target: -3, max: 10 }).targetPct).toBeNull();
    expect(bulletGeometry({ value: 5, target: Number.NaN, max: 10 }).targetPct).toBeNull();
  });
  it('mọi giá trị 0 hoặc max ≤ 0 → thang 1, thanh rỗng, không chia cho 0', () => {
    const g = bulletGeometry({ value: 0 });
    expect(g).toMatchObject({ max: 1, now: 0, fillPct: 0, targetPct: null });
    expect(bulletGeometry({ value: 0, target: 0 })).toMatchObject({ max: 1, targetPct: 0 });
    expect(bulletGeometry({ value: 3, max: 0 }).max).toBe(3);
  });
  it('marker phụ cũng được kẹp; marker không hợp lệ bị bỏ', () => {
    const g = bulletGeometry({
      value: 10,
      target: 20,
      max: 40,
      markers: [
        { at: 10, label: 'lúc bắt đầu' },
        { at: 99, label: 'quá' },
        { at: Number.NaN, label: 'hỏng' },
      ],
    });
    expect(g.markers.map((m) => [m.label, m.pct])).toEqual([
      ['lúc bắt đầu', 25],
      ['quá', 100],
    ]);
  });
});

describe('bulletDelta', () => {
  it('"so với cam kết +n / −n"; bằng nhau → "đúng cam kết"', () => {
    expect(bulletDelta(44, 40, 'cam kết')).toBe('so với cam kết +4');
    expect(bulletDelta(36, 40, 'cam kết')).toBe('so với cam kết −4');
    expect(bulletDelta(40, 40, 'cam kết')).toBe('đúng cam kết');
  });
  it('đơn vị: "%" dính liền, chữ thì cách', () => {
    expect(bulletDelta(55, 50, 'kỳ vọng', '%')).toBe('so với kỳ vọng +5%');
    expect(bulletDelta(30, 40, 'cam kết', 'điểm')).toBe('so với cam kết −10 điểm');
  });
  it('số lẻ làm tròn 1 chữ số; chênh lệch nhỏ hơn làm tròn coi như đúng', () => {
    expect(bulletDelta(10.25, 10, 'velocity TB')).toBe('so với velocity TB +0.3');
    expect(bulletDelta(10.01, 10, 'velocity TB')).toBe('đúng velocity TB');
  });
  it('không hữu hạn → coi như 0', () => {
    expect(bulletDelta(Number.NaN, 5, 'cam kết')).toBe('so với cam kết −5');
  });
});

describe('bulletValueText (bản thay thế bằng chữ đầy đủ)', () => {
  it('có đích: "nhãn: giá trị, đích, chênh lệch"', () => {
    expect(
      bulletValueText({
        label: 'Hoàn thành',
        value: 34,
        target: 40,
        targetLabel: 'cam kết',
        unit: 'điểm',
      }),
    ).toBe('Hoàn thành: 34 điểm, cam kết 40 điểm, so với cam kết −6 điểm');
  });
  it('chỉ có max: "x/max"', () => {
    expect(bulletValueText({ label: 'Hoàn tất', value: 9, max: 30 })).toBe('Hoàn tất: 9/30');
  });
  it('marker phụ được đọc ra; giá trị thật (không kẹp) nằm ở chữ', () => {
    expect(
      bulletValueText({
        label: 'Hoàn thành',
        value: 50,
        target: 40,
        max: 40,
        targetLabel: 'cam kết',
        unit: 'điểm',
        markers: [{ at: 30, label: 'lúc bắt đầu' }],
      }),
    ).toBe('Hoàn thành: 50 điểm, cam kết 40 điểm, so với cam kết +10 điểm, lúc bắt đầu 30 điểm');
  });
  it('thang % chuẩn (max 100, không đích) → "40%", không phải "40/100%"', () => {
    expect(bulletValueText({ label: 'Tiến độ', value: 40, max: 100, unit: '%' })).toBe(
      'Tiến độ: 40%',
    );
  });
  it('đơn vị %', () => {
    expect(
      bulletValueText({
        label: 'Tiến độ',
        value: 40,
        target: 50,
        targetLabel: 'kỳ vọng',
        unit: '%',
      }),
    ).toBe('Tiến độ: 40%, kỳ vọng 50%, so với kỳ vọng −10%');
  });
});
