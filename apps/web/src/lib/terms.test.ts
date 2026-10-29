import { describe, expect, it } from 'vitest';
import { STATUS_CATEGORY_LABEL, TERM } from './terms';

describe('terms', () => {
  it('nhóm trạng thái dùng thuật ngữ Agile tiếng Anh, đủ 3 nhóm', () => {
    expect(STATUS_CATEGORY_LABEL).toEqual({
      TODO: 'To Do',
      IN_PROGRESS: 'In Progress',
      DONE: 'Done',
    });
  });
  it('backlog gọi là "Việc chờ", issue là "công việc"/"việc"', () => {
    expect(TERM.backlog).toBe('Việc chờ');
    expect(TERM.issue).toBe('công việc');
    expect(TERM.issueShort).toBe('việc');
  });
});
