import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESULT_COLUMNS,
  RESULT_COLUMNS,
  cellText,
  columnsStorageKey,
  loadColumns,
  readColumns,
  saveColumns,
} from './resultColumns';

describe('readColumns', () => {
  it('rỗng/hỏng → mặc định', () => {
    expect(readColumns(null)).toEqual(DEFAULT_RESULT_COLUMNS);
    expect(readColumns('không phải json')).toEqual(DEFAULT_RESULT_COLUMNS);
  });
  it('bỏ id lạ, luôn giữ key + summary ở đầu', () => {
    expect(readColumns(JSON.stringify(['status', 'bogus']))).toEqual(['key', 'summary', 'status']);
  });
  it('mảng rỗng / toàn id lạ → mặc định; tối thiểu key + summary được giữ nguyên', () => {
    expect(readColumns('[]')).toEqual(DEFAULT_RESULT_COLUMNS);
    expect(readColumns('["bogus"]')).toEqual(DEFAULT_RESULT_COLUMNS);
    expect(readColumns('["key","summary"]')).toEqual(['key', 'summary']);
  });
  it('khử trùng và xếp theo thứ tự cột chuẩn bất kể thứ tự đã lưu', () => {
    expect(readColumns(JSON.stringify(['due', 'status', 'due', 'type']))).toEqual([
      'key',
      'summary',
      'type',
      'status',
      'due',
    ]);
  });
  it('không phải mảng → mặc định', () => {
    expect(readColumns('{"a":1}')).toEqual(DEFAULT_RESULT_COLUMNS);
  });
});

describe('cellText', () => {
  const base = {
    key: 'DEMO-1',
    summary: 'Đăng nhập lỗi',
    status: { name: 'In Progress' },
    assignee: { displayName: 'An' },
    storyPoints: 5,
    dueDate: '2026-08-05T00:00:00.000Z',
    projectId: 'p1',
  };
  const issue = base as never;
  const ctx = { projectKeyById: new Map([['p1', 'DEMO']]) };
  it('chuỗi thuần đúng định dạng Việt', () => {
    expect(cellText(issue, 'status', ctx)).toBe('In Progress');
    expect(cellText(issue, 'assignee', ctx)).toBe('An');
    expect(cellText(issue, 'points', ctx)).toBe('5');
    expect(cellText(issue, 'project', ctx)).toBe('DEMO');
    expect(cellText(issue, 'due', ctx)).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });
  it('thiếu giá trị → chuỗi rỗng (CSV không in "undefined")', () => {
    expect(cellText({ ...base, assignee: null } as never, 'assignee', ctx)).toBe('');
    expect(cellText({ ...base, storyPoints: null } as never, 'points', ctx)).toBe('');
    expect(cellText({ ...base, dueDate: null } as never, 'due', ctx)).toBe('');
  });
  it('mọi cột đều trả chuỗi (không ném, không "undefined"/"null") với công việc tối thiểu', () => {
    const bare = { key: 'X-1', summary: 's', projectId: 'zz' } as never;
    for (const c of RESULT_COLUMNS) {
      const t = cellText(bare, c.id, ctx);
      expect(typeof t).toBe('string');
      expect(t).not.toMatch(/undefined|null/);
    }
  });
  it('mức nghiêm trọng / người báo / loại / ưu tiên lấy đúng tên', () => {
    const full = {
      ...base,
      severity: { name: 'Critical' },
      reporter: { displayName: 'Bình' },
      type: { name: 'Bug' },
      priority: { name: 'High' },
    } as never;
    expect(cellText(full, 'severity', ctx)).toBe('Critical');
    expect(cellText(full, 'reporter', ctx)).toBe('Bình');
    expect(cellText(full, 'type', ctx)).toBe('Bug');
    expect(cellText(full, 'priority', ctx)).toBe('High');
  });
});

describe('lưu theo người', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  it('khoá có phiên bản + id người dùng; lưu rồi đọc lại đúng', () => {
    expect(columnsStorageKey('u1')).toBe('tirapro:jqlColumns:v1:u1');
    const st = mem();
    saveColumns('u1', ['key', 'summary', 'due'], st);
    expect(loadColumns('u1', st)).toEqual(['key', 'summary', 'due']);
    expect(loadColumns('u2', st)).toEqual(DEFAULT_RESULT_COLUMNS);
  });
  it('storage ném lỗi → mặc định, không sập', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadColumns('u1', boom)).toEqual(DEFAULT_RESULT_COLUMNS);
    expect(() => saveColumns('u1', ['key', 'summary'], boom)).not.toThrow();
  });
  it('trình duyệt chặn dữ liệu site: chạm window.localStorage ném SecurityError → không sập', () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      expect(loadColumns('u1')).toEqual(DEFAULT_RESULT_COLUMNS);
      expect(() => saveColumns('u1', ['key', 'summary'])).not.toThrow();
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', had);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
