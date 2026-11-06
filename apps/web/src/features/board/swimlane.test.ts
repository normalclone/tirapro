import { describe, expect, it } from 'vitest';
import {
  effectiveSwimlane,
  parseSwimlaneOverride,
  readSwimlaneOverride,
  swimlaneStorageKey,
  toggleSwimlane,
  writeSwimlaneOverride,
  type SwimlaneStorage,
} from './swimlane';

describe('swimlane override', () => {
  it('không override → theo cấu hình bảng', () => {
    expect(effectiveSwimlane('epic', null)).toBe('epic');
    expect(effectiveSwimlane('none', 'assignee')).toBe('assignee');
  });
  it('toggle: bảng phẳng ↔ theo người, override được xoá khi trùng cấu hình bảng', () => {
    expect(toggleSwimlane('none', null, 'assignee')).toBe('assignee');
    expect(toggleSwimlane('none', 'assignee', 'assignee')).toBeNull();
  });
  it('toggle trên bảng đã cấu hình theo người: tắt = override none, bật lại = xoá override', () => {
    expect(toggleSwimlane('assignee', null, 'assignee')).toBe('none');
    expect(toggleSwimlane('assignee', 'none', 'assignee')).toBeNull();
  });
  it('toggle trên bảng cấu hình epic: bật theo người, tắt trả về epic (override null)', () => {
    expect(toggleSwimlane('epic', null, 'assignee')).toBe('assignee');
    expect(toggleSwimlane('epic', 'assignee', 'assignee')).toBeNull();
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

describe('swimlane theo team', () => {
  it('bấm "Theo team": bảng phẳng ↔ theo team, override xoá khi trùng cấu hình bảng', () => {
    expect(toggleSwimlane('none', null, 'team')).toBe('team');
    expect(toggleSwimlane('none', 'team', 'team')).toBeNull();
  });
  it('bảng cấu hình theo team: tắt = override none, bật lại = xoá override', () => {
    expect(toggleSwimlane('team', null, 'team')).toBe('none');
    expect(toggleSwimlane('team', 'none', 'team')).toBeNull();
  });
  it('đang theo người rồi bấm team (và ngược lại) → chuyển kiểu, không về mặc định', () => {
    expect(toggleSwimlane('none', 'assignee', 'team')).toBe('team');
    expect(toggleSwimlane('none', 'team', 'assignee')).toBe('assignee');
  });
  it('khoá lưu "team" hợp lệ', () => {
    expect(parseSwimlaneOverride('team')).toBe('team');
  });
});

describe('swimlane storage', () => {
  it('đọc: thiếu/sai → null; hợp lệ → giá trị', () => {
    const { st } = memStorage({
      'tirapro:swimlane:u1:b1': 'team',
      'tirapro:swimlane:u1:b2': 'xx',
      'tirapro:swimlane:u1:b4': 'assignee',
    });
    expect(readSwimlaneOverride('tirapro:swimlane:u1:b1', 'none', st)).toBe('team');
    // Nút "Nhóm theo người" đã bỏ → sở thích riêng cũ theo người bị bỏ qua (không còn cách tắt).
    expect(readSwimlaneOverride('tirapro:swimlane:u1:b4', 'none', st)).toBeNull();
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
