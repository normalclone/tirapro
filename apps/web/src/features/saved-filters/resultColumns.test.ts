import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESULT_COLUMNS,
  RESULT_COLUMNS,
  canHideColumn,
  canMoveColumn,
  cellText,
  columnsStorageKey,
  hiddenColumns,
  hideColumn,
  isDefaultColumns,
  loadColumns,
  moveColumn,
  normalizeColumns,
  readColumns,
  saveColumns,
  scopedColumnsKey,
  showColumn,
  toggleColumn,
  type ResultColumnId,
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
  it('khử trùng và GIỮ thứ tự đã lưu (key + summary luôn ghim ở đầu)', () => {
    expect(readColumns(JSON.stringify(['due', 'status', 'due', 'type']))).toEqual([
      'key',
      'summary',
      'due',
      'status',
      'type',
    ]);
    expect(readColumns(JSON.stringify(['status', 'summary', 'due', 'key']))).toEqual([
      'key',
      'summary',
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
  it('khoá có phiên bản + id người dùng + phạm vi (bộ lọc / ad-hoc); lưu rồi đọc lại đúng thứ tự', () => {
    expect(columnsStorageKey('u1')).toBe('tirapro:jqlColumns:v1:u1');
    expect(scopedColumnsKey('u1', 'adhoc')).toBe('tirapro:jqlColumns:v2:u1:adhoc');
    expect(scopedColumnsKey('u1', 'filter:f9')).toBe('tirapro:jqlColumns:v2:u1:filter:f9');
    const st = mem();
    saveColumns('u1', 'adhoc', ['key', 'summary', 'due', 'status'], st);
    expect(loadColumns('u1', 'adhoc', st)).toEqual(['key', 'summary', 'due', 'status']);
    expect(loadColumns('u2', 'adhoc', st)).toEqual(DEFAULT_RESULT_COLUMNS);
  });
  it('mỗi bộ lọc có bố cục riêng, không ảnh hưởng bộ lọc khác hay ad-hoc', () => {
    const st = mem();
    saveColumns('u1', 'filter:a', ['key', 'summary', 'type'], st);
    saveColumns('u1', 'filter:b', ['key', 'summary', 'due', 'status'], st);
    expect(loadColumns('u1', 'filter:a', st)).toEqual(['key', 'summary', 'type']);
    expect(loadColumns('u1', 'filter:b', st)).toEqual(['key', 'summary', 'due', 'status']);
    expect(loadColumns('u1', 'adhoc', st)).toEqual(DEFAULT_RESULT_COLUMNS);
  });
  it('chưa có bố cục riêng → dùng lựa chọn cột cũ của người dùng (khoá v1), rồi mới tới mặc định', () => {
    const st = mem();
    st.setItem(columnsStorageKey('u1'), JSON.stringify(['key', 'summary', 'due']));
    expect(loadColumns('u1', 'filter:a', st)).toEqual(['key', 'summary', 'due']);
    saveColumns('u1', 'filter:a', ['key', 'summary', 'type'], st);
    expect(loadColumns('u1', 'filter:a', st)).toEqual(['key', 'summary', 'type']);
  });
  it('dữ liệu lưu hỏng (không phải JSON / sai kiểu) → mặc định, không ném', () => {
    const st = mem();
    st.setItem(scopedColumnsKey('u1', 'adhoc'), '{không phải json');
    expect(loadColumns('u1', 'adhoc', st)).toEqual(DEFAULT_RESULT_COLUMNS);
    st.setItem(scopedColumnsKey('u1', 'adhoc'), JSON.stringify({ columns: 'x' }));
    expect(loadColumns('u1', 'adhoc', st)).toEqual(DEFAULT_RESULT_COLUMNS);
    st.setItem(scopedColumnsKey('u1', 'adhoc'), '42');
    expect(loadColumns('u1', 'adhoc', st)).toEqual(DEFAULT_RESULT_COLUMNS);
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
    expect(loadColumns('u1', 'adhoc', boom)).toEqual(DEFAULT_RESULT_COLUMNS);
    expect(() => saveColumns('u1', 'adhoc', ['key', 'summary'], boom)).not.toThrow();
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
      expect(loadColumns('u1', 'adhoc')).toEqual(DEFAULT_RESULT_COLUMNS);
      expect(() => saveColumns('u1', 'adhoc', ['key', 'summary'])).not.toThrow();
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', had);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

const D = DEFAULT_RESULT_COLUMNS; // key, summary, status, priority, assignee, points, due

describe('normalizeColumns — bỏ id lạ, ghim key/summary, thêm cột mặc định MỚI', () => {
  it('giữ thứ tự, bỏ id lạ/trùng/không phải chuỗi', () => {
    expect(normalizeColumns(['key', 'summary', 'due', 'x', 7, 'due', 'type'])).toEqual([
      'key',
      'summary',
      'due',
      'type',
    ]);
  });
  it('thiếu key/summary → thêm lên đầu theo thứ tự chuẩn', () => {
    expect(normalizeColumns(['due', 'type'])).toEqual(['key', 'summary', 'due', 'type']);
  });
  it('không phải mảng / rỗng / toàn id lạ → mặc định (bản sao, không dùng chung tham chiếu)', () => {
    for (const bad of [null, undefined, 'a', 3, {}, [], ['zz']]) {
      const out = normalizeColumns(bad);
      expect(out).toEqual(D);
      expect(out).not.toBe(D);
    }
  });
  it('knownIds: cột mặc định mà bố cục lưu CHƯA biết (mới thêm sau) được nối vào cuối; cột người dùng đã ẩn thì không', () => {
    // người dùng đã ẩn "points" (có trong known, vắng trong columns) → không hiện lại
    const known = ['key', 'summary', 'status', 'priority', 'assignee', 'points', 'due', 'type'];
    expect(normalizeColumns(['key', 'summary', 'due'], known)).toEqual(['key', 'summary', 'due']);
    // 'priority' mới thêm vào mặc định, bố cục lưu chưa biết → nối vào cuối
    expect(
      normalizeColumns(['key', 'summary', 'due'], ['key', 'summary', 'status', 'due']),
    ).toEqual(['key', 'summary', 'due', 'priority', 'assignee', 'points']);
  });
  it('không có knownIds (dữ liệu cũ) → không nối thêm gì', () => {
    expect(normalizeColumns(['key', 'summary', 'due'])).toEqual(['key', 'summary', 'due']);
  });
});

describe('moveColumn / canMoveColumn', () => {
  it('dời trái/phải đổi chỗ với cột kề', () => {
    expect(moveColumn(D, 'status', 1)).toEqual([
      'key',
      'summary',
      'priority',
      'status',
      'assignee',
      'points',
      'due',
    ]);
    expect(moveColumn(D, 'due', -1)).toEqual([
      'key',
      'summary',
      'status',
      'priority',
      'assignee',
      'due',
      'points',
    ]);
  });
  it('không sửa mảng gốc', () => {
    const copy = [...D];
    moveColumn(D, 'status', 1);
    expect(D).toEqual(copy);
  });
  it('cột đầu không dời trái được, cột cuối không dời phải được (trả nguyên tham chiếu)', () => {
    expect(canMoveColumn(D, 'key', -1)).toBe(false);
    expect(canMoveColumn(D, 'due', 1)).toBe(false);
    expect(moveColumn(D, 'due', 1)).toBe(D);
    expect(moveColumn(D, 'key', -1)).toBe(D);
  });
  it('cột đầu của phần di chuyển được không lọt vào vùng ghim (key/summary)', () => {
    expect(canMoveColumn(D, 'status', -1)).toBe(false);
    expect(moveColumn(D, 'status', -1)).toBe(D);
  });
  it('key/summary bị ghim: không dời được dù ở giữa', () => {
    expect(canMoveColumn(D, 'summary', 1)).toBe(false);
    expect(canMoveColumn(D, 'key', 1)).toBe(false);
    expect(moveColumn(D, 'summary', 1)).toBe(D);
  });
  it('id không có trong bảng → không đổi', () => {
    expect(canMoveColumn(D, 'severity', 1)).toBe(false);
    expect(moveColumn(D, 'severity', 1)).toBe(D);
  });
  it('bảng chỉ có một cột di chuyển được → hai hướng đều tắt', () => {
    const one: ResultColumnId[] = ['key', 'summary', 'due'];
    expect(canMoveColumn(one, 'due', -1)).toBe(false);
    expect(canMoveColumn(one, 'due', 1)).toBe(false);
  });
});

describe('hideColumn / canHideColumn', () => {
  it('ẩn cột thường, giữ thứ tự các cột còn lại', () => {
    expect(hideColumn(D, 'priority')).toEqual([
      'key',
      'summary',
      'status',
      'assignee',
      'points',
      'due',
    ]);
  });
  it('cột khoá (key/summary) không ẩn được', () => {
    expect(canHideColumn(D, 'key')).toBe(false);
    expect(hideColumn(D, 'summary')).toBe(D);
  });
  it('luôn còn ít nhất một cột hiện: cột hiện cuối cùng không ẩn được (kể cả khi không khoá)', () => {
    const last = ['due'] as ResultColumnId[];
    expect(canHideColumn(last, 'due')).toBe(false);
    expect(hideColumn(last, 'due')).toBe(last);
  });
  it('id không hiện → không đổi', () => {
    expect(canHideColumn(D, 'severity')).toBe(false);
    expect(hideColumn(D, 'severity')).toBe(D);
  });
});

describe('showColumn / toggleColumn / hiddenColumns / isDefaultColumns', () => {
  it('hiện cột: chèn ngay sau cột đang mở menu; không có thì nối cuối', () => {
    expect(showColumn(D, 'type', 'status')).toEqual([
      'key',
      'summary',
      'status',
      'type',
      'priority',
      'assignee',
      'points',
      'due',
    ]);
    expect(showColumn(D, 'type')).toEqual([...D, 'type']);
    expect(showColumn(D, 'type', 'không-có' as ResultColumnId)).toEqual([...D, 'type']);
  });
  it('hiện cột đã hiện / id lạ → không đổi', () => {
    expect(showColumn(D, 'status')).toBe(D);
    expect(showColumn(D, 'bogus' as ResultColumnId)).toBe(D);
  });
  it('toggle: bật thì nối cuối, tắt thì bỏ; cột khoá không đổi', () => {
    expect(toggleColumn(D, 'type')).toEqual([...D, 'type']);
    expect(toggleColumn(D, 'due')).toEqual(D.slice(0, -1));
    expect(toggleColumn(D, 'key')).toBe(D);
  });
  it('hiddenColumns theo thứ tự chuẩn; rỗng khi hiện đủ', () => {
    expect(hiddenColumns(D).map((c) => c.id)).toEqual([
      'type',
      'reporter',
      'updated',
      'project',
      'severity',
    ]);
    expect(hiddenColumns(RESULT_COLUMNS.map((c) => c.id))).toEqual([]);
  });
  it('isDefaultColumns so cả thứ tự', () => {
    expect(isDefaultColumns(D)).toBe(true);
    expect(isDefaultColumns(moveColumn(D, 'status', 1))).toBe(false);
    expect(isDefaultColumns(hideColumn(D, 'due'))).toBe(false);
  });
});
