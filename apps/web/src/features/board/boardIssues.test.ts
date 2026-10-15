import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { freshenBoardIssues } from './boardIssues';

const i = (id: string, rank: string, extra: Partial<IssueDto> = {}) =>
  ({ id, rank, version: 1, ...extra }) as IssueDto;

describe('freshenBoardIssues', () => {
  it('lấy rank/trạng thái MỚI từ cache dự án cho việc có trong tập lọc (move chỉ vá cache dự án)', () => {
    const filtered = [i('a', 'b'), i('b', 'c')];
    const project = [i('a', 'z', { version: 2 }), i('b', 'c')];
    const out = freshenBoardIssues(filtered, project);
    expect(out.map((x) => [x.id, x.rank, x.version])).toEqual([
      ['a', 'z', 2],
      ['b', 'c', 1],
    ]);
  });
  it('giữ tập của bảng lọc (không thêm việc chỉ có ở cache dự án); việc không còn trong cache dự án giữ bản cũ', () => {
    const out = freshenBoardIssues([i('a', 'b'), i('gone', 'x')], [i('a', 'b'), i('other', 'q')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'gone']);
  });
});
