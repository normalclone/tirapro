import { describe, expect, it } from 'vitest';
import { pointsCell } from './pointsCell';

describe('pointsCell', () => {
  it('lá: điểm riêng hoặc dấu gạch', () => {
    expect(pointsCell(5, null)).toMatchObject({ text: '5', strong: true });
    expect(pointsCell(null, null)).toMatchObject({ text: '—', strong: false });
  });
  it('có con và có điểm bên trong: done/total, tooltip nêu số việc', () => {
    const c = pointsCell(null, { donePoints: 5, totalPoints: 13, count: 3 });
    expect(c.text).toBe('5/13');
    expect(c.title).toContain('5 đã xong / 13');
    expect(c.title).toContain('3 việc');
  });
  it('có điểm riêng lẫn bên trong: vẫn hiện cộng dồn và nhắc điểm riêng', () => {
    expect(pointsCell(8, { donePoints: 0, totalPoints: 3, count: 1 }).title).toContain('8 điểm');
  });
  it('có con nhưng bên trong chưa có điểm: rơi về điểm riêng', () => {
    expect(pointsCell(2, { donePoints: 0, totalPoints: 0, count: 2 })).toMatchObject({ text: '2' });
    expect(pointsCell(null, { donePoints: 0, totalPoints: 0, count: 2 })).toMatchObject({
      text: '—',
    });
  });
});
