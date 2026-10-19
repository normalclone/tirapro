import { describe, expect, it } from 'vitest';
import type { BoardDto } from '@tirapro/types';
import { boardMetaPatch } from './boardPatch';

const board = {
  id: 'b1',
  name: 'Bảng',
  type: 'SCRUM',
  filterJql: null,
  swimlaneBy: 'none',
} as unknown as BoardDto;
const same = { name: 'Bảng', jql: '', swimlane: 'none', type: 'SCRUM' } as const;

describe('boardMetaPatch', () => {
  it('không đổi gì => {}', () => {
    expect(boardMetaPatch(board, same)).toEqual({});
    expect(boardMetaPatch(board, { ...same, name: '  Bảng ', jql: '  ' })).toEqual({});
  });
  it('đổi loại Scrum -> Kanban chỉ gửi { type }', () => {
    expect(boardMetaPatch(board, { ...same, type: 'KANBAN' })).toEqual({ type: 'KANBAN' });
  });
  it('đổi loại cùng các trường khác trong một body', () => {
    expect(
      boardMetaPatch(board, {
        name: 'Mới',
        jql: 'priority = High',
        swimlane: 'epic',
        type: 'KANBAN',
      }),
    ).toEqual({ name: 'Mới', filterJql: 'priority = High', swimlaneBy: 'epic', type: 'KANBAN' });
  });
  it('xoá bộ lọc => filterJql null', () => {
    expect(boardMetaPatch({ ...board, filterJql: 'a = b' }, same)).toEqual({ filterJql: null });
  });
});
