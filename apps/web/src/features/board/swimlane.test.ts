import { describe, expect, it } from 'vitest';
import {
  effectiveSwimlane,
  parseSwimlaneOverride,
  readSwimlaneOverride,
  swimlaneStorageKey,
  toggleAssigneeSwimlane,
  writeSwimlaneOverride,
  type SwimlaneStorage,
} from './swimlane';

describe('swimlane override', () => {
  it('không override → theo cấu hình bảng', () => {
    expect(effectiveSwimlane('epic', null)).toBe('epic');
    expect(effectiveSwimlane('none', 'assignee')).toBe('assignee');
  });
  it('toggle: bảng phẳng ↔ theo người, override được xoá khi trùng cấu hình bảng', () => {
    expect(toggleAssigneeSwimlane('none', null)).toBe('assignee');
    expect(toggleAssigneeSwimlane('none', 'assignee')).toBeNull();
  });
  it('toggle trên bảng đã cấu hình theo người: tắt = override none, bật lại = xoá override', () => {
    expect(toggleAssigneeSwimlane('assignee', null)).toBe('none');
    expect(toggleAssigneeSwimlane('assignee', 'none')).toBeNull();
  });
  it('toggle trên bảng cấu hình epic: bật theo người, tắt trả về epic (override null)', () => {
    expect(toggleAssigneeSwimlane('epic', null)).toBe('assignee');
    expect(toggleAssigneeSwimlane('epic', 'assignee')).toBeNull();
  });
  it('parse: chỉ nhận giá trị hợp lệ', () => {
    expect(parseSwimlaneOverride('assignee')).toBe('assignee');
    expect(parseSwimlaneOverride('none')).toBe('none');
    expect(parseSwimlaneOverride('linh-tinh')).toBeNull();
    expect(parseSwimlaneOverride(null)).toBeNull();
  });
  it('khoá lưu theo người và theo bảng', () => {
    expect(swimlaneStorageKey('u1', 'b1')).toBe('tirapro:swimlane:u1:b1');
  });
});

const memStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  const st: SwimlaneStorage = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
  return { m, st };
};

describe('swimlane storage', () => {
  it('đọc: thiếu/sai → null; hợp lệ → giá trị', () => {
    const { st } = memStorage({
      'tirapro:swimlane:u1:b1': 'assignee',
      'tirapro:swimlane:u1:b2': 'xx',
    });
    expect(readSwimlaneOverride('tirapro:swimlane:u1:b1', 'none', st)).toBe('assignee');
    expect(readSwimlaneOverride('tirapro:swimlane:u1:b2', 'none', st)).toBeNull();
    expect(readSwimlaneOverride('tirapro:swimlane:u1:b3', 'none', st)).toBeNull();
    expect(readSwimlaneOverride(null, 'none', st)).toBeNull();
  });
  it('đọc: override trùng cấu hình bảng hiện tại coi như null (admin đổi cấu hình sau vẫn có hiệu lực)', () => {
    const { st } = memStorage({ k: 'none' });
    expect(readSwimlaneOverride('k', 'none', st)).toBeNull();
    expect(readSwimlaneOverride('k', 'assignee', st)).toBe('none');
  });
  it('ghi: giá trị thì lưu, null thì xoá khoá', () => {
    const { m, st } = memStorage();
    writeSwimlaneOverride('k', 'assignee', st);
    expect(m.get('k')).toBe('assignee');
    writeSwimlaneOverride('k', null, st);
    expect(m.has('k')).toBe(false);
  });
  it('storage ném lỗi → không văng, đọc về null', () => {
    const bad: SwimlaneStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSwimlaneOverride('k', 'none', bad)).toBeNull();
    expect(() => writeSwimlaneOverride('k', 'assignee', bad)).not.toThrow();
  });
});
