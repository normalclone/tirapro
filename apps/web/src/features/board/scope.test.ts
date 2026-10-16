import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { noActiveSprintHint, scopeBoardIssues, swimlaneEmptyKind } from './scope';

const mk = (id: string, sprintId: string | null) => ({ id, sprintId }) as unknown as IssueDto;
const all = [mk('a', 's1'), mk('b', 's2'), mk('c', null), mk('d', 's1')];

describe('scopeBoardIssues', () => {
  it('Scrum + có sprint chạy: chỉ việc của sprint đó, giữ thứ tự', () => {
    expect(scopeBoardIssues('SCRUM', all, 's1').map((i) => i.id)).toEqual(['a', 'd']);
  });
  it('Scrum + không có sprint chạy: rỗng (không phải tất cả)', () => {
    expect(scopeBoardIssues('SCRUM', all, null)).toEqual([]);
  });
  it('Scrum: việc không thuộc sprint nào (backlog) không hiện', () => {
    expect(scopeBoardIssues('SCRUM', all, 's2').map((i) => i.id)).toEqual(['b']);
  });
  it('Kanban: giữ nguyên mọi việc, bất kể sprint', () => {
    expect(scopeBoardIssues('KANBAN', all, 's1')).toBe(all);
    expect(scopeBoardIssues('KANBAN', all, null)).toBe(all);
  });
  it('trả cùng tham chiếu mảng khi không đổi (Kanban) để useMemo phía sau không vẽ lại thừa', () => {
    const a = scopeBoardIssues('KANBAN', all, null);
    expect(scopeBoardIssues('KANBAN', all, null)).toBe(a);
  });
});

describe('noActiveSprintHint — câu hướng dẫn khi Scrum chưa có sprint chạy', () => {
  it('người quản lý sprint: được dẫn tới Việc chờ để bắt đầu', () => {
    expect(noActiveSprintHint({ canManageSprint: true, archived: false })).toBe(
      'Bảng Scrum chỉ hiện việc của sprint đang chạy. Lên kế hoạch và bắt đầu một sprint ở Việc chờ.',
    );
  });
  it('không có sprint:manage: nhờ quản trị dự án', () => {
    expect(noActiveSprintHint({ canManageSprint: false, archived: false })).toBe(
      'Bảng Scrum chỉ hiện việc của sprint đang chạy. Nhờ quản trị dự án bắt đầu một sprint.',
    );
  });
  it('dự án đã lưu trữ: không ai bắt đầu được sprint nên không bảo "nhờ quản trị"', () => {
    const t = noActiveSprintHint({ canManageSprint: false, archived: true });
    expect(t).toContain('lưu trữ');
    expect(t).not.toContain('Nhờ quản trị');
  });
});

describe('swimlaneEmptyKind — vì sao chế độ swimlane không có hàng nào', () => {
  it('có bộ lọc đang áp: khớp bộ lọc', () => {
    expect(swimlaneEmptyKind({ isScrum: true, scopedCount: 5, filtered: true })).toBe('filtered');
    expect(swimlaneEmptyKind({ isScrum: true, scopedCount: 0, filtered: true })).toBe('filtered');
  });
  it('Scrum, sprint đang chạy không có việc, không lọc: sprint trống (không dùng câu "khớp bộ lọc")', () => {
    expect(swimlaneEmptyKind({ isScrum: true, scopedCount: 0, filtered: false })).toBe('sprint');
  });
  it('Kanban không có việc, không lọc: bảng trống', () => {
    expect(swimlaneEmptyKind({ isScrum: false, scopedCount: 0, filtered: false })).toBe('board');
  });
  it('có việc nhưng không hàng nào mà cũng không lọc (không xảy ra): coi như bộ lọc', () => {
    expect(swimlaneEmptyKind({ isScrum: true, scopedCount: 3, filtered: false })).toBe('filtered');
  });
});
