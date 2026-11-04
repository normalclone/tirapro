import { describe, expect, it } from 'vitest';
import type { JqlOrderBy } from '@tirapro/shared';
import type { PersonalIssueDto } from '@tirapro/types';
import { buildComparator } from './me-search-order';

const issue = (id: string, p: Record<string, unknown> = {}): PersonalIssueDto =>
  ({
    id,
    key: id,
    updatedAt: '2026-01-01T00:00:00.000Z',
    dueDate: null,
    severity: null,
    priority: null,
    storyPoints: null,
    type: { name: 'Bug' },
    status: { name: 'Open', category: 'TODO' },
    workspace: { id: 'w', name: 'W' },
    projectKey: 'P',
    ...p,
  }) as unknown as PersonalIssueDto;

const sorted = (xs: PersonalIssueDto[], order: JqlOrderBy[]) =>
  [...xs].sort(buildComparator(order)).map((x) => x.id);

describe('buildComparator (gộp xuyên workspace)', () => {
  it('mặc định: updatedAt giảm dần rồi id tăng dần', () => {
    const xs = [
      issue('b', { updatedAt: '2026-02-01T00:00:00.000Z' }),
      issue('a', { updatedAt: '2026-02-01T00:00:00.000Z' }),
      issue('c', { updatedAt: '2026-03-01T00:00:00.000Z' }),
    ];
    expect(sorted(xs, [])).toEqual(['c', 'a', 'b']);
  });

  it('NULL như Postgres: ASC cuối, DESC đầu', () => {
    const xs = [
      issue('none'),
      issue('d1', { dueDate: '2026-04-01' }),
      issue('d2', { dueDate: '2026-05-01' }),
    ];
    expect(sorted(xs, [{ field: 'due', direction: 'ASC' }])).toEqual(['d1', 'd2', 'none']);
    expect(sorted(xs, [{ field: 'due', direction: 'DESC' }])).toEqual(['none', 'd2', 'd1']);
  });

  it('severity theo rank, việc chưa đặt mức luôn cuối (cả ASC lẫn DESC)', () => {
    const xs = [
      issue('none'),
      issue('lo', { severity: { rank: 1 } }),
      issue('hi', { severity: { rank: 5 } }),
    ];
    expect(sorted(xs, [{ field: 'severity', direction: 'DESC' }])).toEqual(['hi', 'lo', 'none']);
    expect(sorted(xs, [{ field: 'severity', direction: 'ASC' }])).toEqual(['lo', 'hi', 'none']);
  });

  it('nhiều khoá: khoá sau chỉ phân xử khi khoá trước bằng nhau; điểm so như số', () => {
    const xs = [
      issue('x', { storyPoints: 10, type: { name: 'B' } }),
      issue('y', { storyPoints: 9, type: { name: 'B' } }),
      issue('z', { storyPoints: 10, type: { name: 'A' } }),
    ];
    expect(
      sorted(xs, [
        { field: 'storyPoints', direction: 'DESC' },
        { field: 'type', direction: 'ASC' },
      ]),
    ).toEqual(['z', 'x', 'y']);
  });

  it('trường nhãn/thành phần/text rơi về updatedAt như compileOrder', () => {
    const xs = [
      issue('old', { updatedAt: '2026-01-01T00:00:00.000Z' }),
      issue('new', { updatedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(sorted(xs, [{ field: 'labels', direction: 'DESC' }])).toEqual(['new', 'old']);
  });
});
