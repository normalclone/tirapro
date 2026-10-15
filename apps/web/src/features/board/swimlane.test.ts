import { describe, expect, it } from 'vitest';
import {
  effectiveSwimlane,
  parseSwimlaneOverride,
  swimlaneStorageKey,
  toggleAssigneeSwimlane,
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
