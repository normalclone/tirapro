import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { scopeBoardIssues } from './scope';

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
