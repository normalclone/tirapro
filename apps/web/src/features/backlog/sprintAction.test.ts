import { describe, expect, it } from 'vitest';
import { parseSprintAction, sprintActionPath, stripSprintAction } from './sprintAction';

describe('sprintAction', () => {
  it('đọc create-sprint / start / complete', () => {
    expect(parseSprintAction('?action=create-sprint')).toEqual({ action: 'create-sprint' });
    expect(parseSprintAction('?action=start&sprint=s3')).toEqual({
      action: 'start',
      sprintId: 's3',
    });
    expect(parseSprintAction('?sprint=s2&action=complete')).toEqual({
      action: 'complete',
      sprintId: 's2',
    });
  });
  it('start/complete thiếu sprint, hoặc action lạ → null', () => {
    expect(parseSprintAction('?action=start')).toBeNull();
    expect(parseSprintAction('?action=complete&sprint=')).toBeNull();
    expect(parseSprintAction('?action=drop-table')).toBeNull();
    expect(parseSprintAction('')).toBeNull();
  });
  it('dựng đường dẫn và đọc lại ra đúng', () => {
    for (const a of [
      { action: 'create-sprint' },
      { action: 'start', sprintId: 'a b' },
      { action: 'complete', sprintId: 's2' },
    ] as const) {
      const path = sprintActionPath('DEMO', a);
      expect(path.startsWith('/p/DEMO/backlog?')).toBe(true);
      expect(parseSprintAction(path.slice(path.indexOf('?')))).toEqual(a);
    }
  });
  it('xoá tham số xử lý rồi, giữ tham số khác (peek)', () => {
    expect(stripSprintAction('?action=start&sprint=s3&peek=DEMO-1')).toBe('?peek=DEMO-1');
    expect(stripSprintAction('?action=create-sprint')).toBe('');
  });
});
