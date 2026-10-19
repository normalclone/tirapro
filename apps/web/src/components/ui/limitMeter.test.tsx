import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LimitMeter } from './LimitMeter';
import { limitLevel, recentVelocity, sprintCapacityLimit } from './limitLevel';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('limitLevel(used, limit)', () => {
  it('dưới 80% là trung tính', () => {
    expect(limitLevel(0, 5).level).toBe('ok');
    expect(limitLevel(3, 5).level).toBe('ok');
    expect(limitLevel(79, 100).level).toBe('ok');
  });
  it('80–99% là cảnh báo (kể cả đúng 80%)', () => {
    expect(limitLevel(4, 5).level).toBe('warn');
    expect(limitLevel(80, 100).level).toBe('warn');
    expect(limitLevel(99, 100).level).toBe('warn');
  });
  it('đúng 100% là đầy (máy chủ chặn khi current + incoming > limit)', () => {
    expect(limitLevel(5, 5)).toMatchObject({ level: 'full', over: 0 });
    expect(limitLevel(1, 1).level).toBe('full');
  });
  it('trên 100% là vượt N', () => {
    expect(limitLevel(6, 5)).toMatchObject({ level: 'over', over: 1 });
    expect(limitLevel(34, 30)).toMatchObject({ level: 'over', over: 4 });
  });
  it('không có giới hạn / giới hạn ≤ 0 / NaN → none (không vẽ đồng hồ)', () => {
    expect(limitLevel(3, null).level).toBe('none');
    expect(limitLevel(3, undefined).level).toBe('none');
    expect(limitLevel(3, 0).level).toBe('none');
    expect(limitLevel(3, -2).level).toBe('none');
    expect(limitLevel(3, Number.NaN).level).toBe('none');
    expect(limitLevel(3, Number.POSITIVE_INFINITY).level).toBe('none');
  });
  it('used NaN / âm coi như 0; pct kẹp 0..1 cho thanh', () => {
    expect(limitLevel(Number.NaN, 5)).toMatchObject({ level: 'ok', pct: 0 });
    expect(limitLevel(-3, 5)).toMatchObject({ level: 'ok', pct: 0 });
    expect(limitLevel(8, 5).pct).toBe(1);
    expect(limitLevel(2, 4).pct).toBe(0.5);
  });
  it('điểm lẻ (velocity TB có số thập phân) không sai do số thực', () => {
    expect(limitLevel(0.8, 1).level).toBe('warn');
    expect(limitLevel(10.5, 10.5).level).toBe('full');
    expect(limitLevel(11, 10.5)).toMatchObject({ level: 'over', over: 0.5 });
  });
});

describe('recentVelocity(sprints)', () => {
  const c = (...n: number[]) => n.map((completed) => ({ completed }));
  it('TB của 3 sprint đã đóng GẦN NHẤT (API trả cũ → mới)', () => {
    expect(recentVelocity(c(100, 10, 20, 30))).toEqual({ avg: 20, count: 3 });
  });
  it('ít hơn 3 → dùng số có; chưa có → count 0', () => {
    expect(recentVelocity(c(16))).toEqual({ avg: 16, count: 1 });
    expect(recentVelocity(c(10, 15))).toEqual({ avg: 12.5, count: 2 });
    expect(recentVelocity([])).toEqual({ avg: 0, count: 0 });
    expect(recentVelocity(undefined)).toEqual({ avg: 0, count: 0 });
  });
  it('bỏ qua giá trị không hữu hạn; làm tròn 2 chữ số', () => {
    expect(recentVelocity(c(1, 1, 2))).toEqual({ avg: 1.33, count: 3 });
    expect(recentVelocity(c(Number.NaN, 4))).toEqual({ avg: 4, count: 1 });
  });
});

describe('sprintCapacityLimit(velocity)', () => {
  it('chưa có lịch sử (0, âm, NaN, undefined) → null: ẩn đồng hồ', () => {
    expect(sprintCapacityLimit(0)).toBeNull();
    expect(sprintCapacityLimit(undefined)).toBeNull();
    expect(sprintCapacityLimit(Number.NaN)).toBeNull();
    expect(sprintCapacityLimit(-1)).toBeNull();
  });
  it('có velocity → giữ nguyên số', () => {
    expect(sprintCapacityLimit(30)).toBe(30);
  });
});

const html = (props: Partial<Parameters<typeof LimitMeter>[0]> = {}) =>
  renderToStaticMarkup(<LimitMeter used={3} limit={5} label="Giới hạn WIP" {...props} />);

describe('<LimitMeter>', () => {
  it('role=meter + aria-valuenow/min/max + tên truy cập', () => {
    const h = html();
    expect(h).toMatch(/role="meter"/);
    expect(h).toMatch(/aria-valuenow="3"/);
    expect(h).toMatch(/aria-valuemin="0"/);
    expect(h).toMatch(/aria-valuemax="5"/);
    expect(h).toMatch(/aria-label="Giới hạn WIP"/);
    expect(h).toMatch(/aria-valuetext="3\/5"/);
  });
  it('không có giới hạn → không render gì', () => {
    expect(html({ limit: null })).toBe('');
  });
  it('luôn có chữ used/limit; màu không phải tín hiệu duy nhất', () => {
    expect(html()).toContain('3/5');
    const warn = html({ used: 4 });
    expect(warn).toContain('4/5');
    expect(warn).toContain('Gần đầy');
    expect(warn).toMatch(/aria-valuetext="4\/5 — Gần đầy"/);
    expect(html({ used: 5 })).toContain('Đầy');
    expect(html({ used: 7 })).toContain('Vượt 2');
    // aria-valuenow kẹp ở giới hạn; số thật ở aria-valuetext
    expect(html({ used: 7 })).toMatch(/aria-valuenow="5"/);
    expect(html({ used: 7 })).toMatch(/aria-valuetext="7\/5 — Vượt 2"/);
  });
  it('aria-valuenow luôn trong [min,max]; chữ hiển thị aria-hidden (trùng valuetext)', () => {
    for (const used of [-3, 0, 5, 9, Number.NaN]) {
      const h = html({ used });
      const now = Number(/aria-valuenow="([^"]+)"/.exec(h)?.[1]);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).toBeLessThanOrEqual(5);
    }
    expect(html({ used: 4 })).toMatch(/<p aria-hidden="true"/);
  });
  it('"Đầy" và "Vượt" in đậm; track dùng border-strong', () => {
    expect(html({ used: 5 })).toMatch(/font-semibold/);
    expect(html({ used: 4 })).not.toMatch(/font-semibold/);
    expect(html()).toMatch(/bg-border-strong/);
  });
  it('tông: strict đỏ khi đầy/vượt; advisory dùng cam, không đỏ', () => {
    for (const used of [5, 7]) {
      expect(html({ used })).toMatch(/bg-danger/);
      const a = html({ used, tone: 'advisory' });
      expect(a).not.toMatch(/danger/);
      expect(a).toMatch(/bg-warning/);
    }
  });
  it('vượt: aria-valuemax vẫn là giới hạn, thanh đầy 100%', () => {
    const h = html({ used: 7 });
    expect(h).toMatch(/aria-valuemax="5"/);
    expect(h).toMatch(/width:100%/);
  });
  it('thanh theo tỉ lệ', () => {
    expect(html({ used: 1, limit: 4 })).toMatch(/width:25%/);
  });
  it('tiền tố, đơn vị và nhãn tuỳ biến (sức chứa sprint)', () => {
    const h = html({
      used: 34,
      limit: 30,
      label: 'Sức chứa sprint',
      unit: 'điểm',
      labels: { over: (n) => `hơn velocity TB ${n}` },
    });
    expect(h).toContain('34/30 điểm — hơn velocity TB 4');
    expect(h).toMatch(/aria-label="Sức chứa sprint"/);
  });
  it('mô tả dài đi qua aria-describedby (không nhét vào tên)', () => {
    const h = html({ used: 5, description: 'Cột đã đầy.' });
    expect(h).toMatch(/aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(h)?.[1];
    expect(h).toContain(`id="${id}"`);
    expect(h).toContain('Cột đã đầy.');
  });
  it('không dùng viền trái (side-stripe) và có motion-reduce', () => {
    const src = read('components/ui/LimitMeter.tsx');
    expect(src).not.toMatch(/border-l-|border-left/);
    expect(src).toMatch(/motion-reduce/);
  });
});

describe('dùng đồng hồ', () => {
  it('Column dùng LimitMeter thay chip "WIP x/y", giữ nguồn wipUsed', () => {
    const col = read('features/board/Column.tsx');
    expect(col).toMatch(/<LimitMeter/);
    expect(col).not.toMatch(/WIP \{wipUsed\}/);
    expect(col).toMatch(/wipUsed/);
    expect(col).toMatch(/Vẫn chuyển/); // giữ lời giải thích cũ
    expect(read('features/board/BoardPage.tsx').match(/function wipCount/g)).toHaveLength(1);
  });
  it('Backlog: lấy velocity một lần ở trang, không ở từng Section', () => {
    const src = read('features/backlog/BacklogPage.tsx');
    expect(src.match(/useVelocity\(/g)).toHaveLength(1);
    expect(src.indexOf('useVelocity(')).toBeLessThan(src.indexOf('function Section('));
    expect(src).toMatch(/Sức chứa sprint/);
    expect(src).toMatch(/recentVelocity\(/);
    expect(src).toMatch(/tone="advisory"/);
    // chỉ tải velocity khi có sprint chưa đóng
    expect(src).toMatch(/hasOpenSprint/);
    expect(src).toMatch(/Velocity TB \$\{recent\.count\} sprint gần nhất/);
  });
});
