import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import { commonNextStatuses, groupByPrev, labelsToUndo, prevValueOf } from './bulkEdit';

const wf = {
  id: 'w',
  statuses: [
    { id: 'todo', name: 'To Do', category: 'TODO' },
    { id: 'prog', name: 'In Progress', category: 'IN_PROGRESS' },
    { id: 'rev', name: 'In Review', category: 'IN_PROGRESS' },
    { id: 'done', name: 'Done', category: 'DONE' },
  ],
  transitions: [
    { fromStatusId: 'todo', toStatusId: 'prog' },
    { fromStatusId: 'prog', toStatusId: 'rev' },
    { fromStatusId: 'prog', toStatusId: 'done' },
    { fromStatusId: 'rev', toStatusId: 'done' },
    { fromStatusId: null, toStatusId: 'todo' },
  ],
} as unknown as Workflow;
const iss = (id: string, statusId: string, extra: Partial<IssueDto> = {}) =>
  ({
    id,
    status: { id: statusId },
    priority: null,
    storyPoints: null,
    epicId: null,
    ...extra,
  }) as unknown as IssueDto;

describe('commonNextStatuses', () => {
  it('một trạng thái: đúng các bước kế', () => {
    expect(
      commonNextStatuses([wf], [iss('a', 'prog')])
        .map((s) => s.id)
        .sort(),
    ).toEqual(['done', 'rev', 'todo']);
  });
  it('nhiều trạng thái: giao của các bước kế', () => {
    expect(
      commonNextStatuses([wf], [iss('a', 'prog'), iss('b', 'rev')])
        .map((s) => s.id)
        .sort(),
    ).toEqual(['done', 'todo']);
  });
  it('rỗng khi không có bước chung / chưa tải workflow / lô rỗng', () => {
    expect(commonNextStatuses([wf], [iss('a', 'todo'), iss('b', 'rev')]).map((s) => s.id)).toEqual(
      [],
    );
    expect(commonNextStatuses(undefined, [iss('a', 'todo')])).toEqual([]);
    expect(commonNextStatuses([wf], [])).toEqual([]);
  });
});

describe('prevValueOf / groupByPrev', () => {
  it('lấy giá trị cũ đúng theo trường', () => {
    expect(
      prevValueOf({ ...iss('a', 's'), priority: { id: 'p1' } } as IssueDto, 'priorityId'),
    ).toBe('p1');
    expect(prevValueOf(iss('a', 's1'), 'statusId')).toBe('s1');
    expect(prevValueOf(iss('a', 's', { storyPoints: 3 }), 'storyPoints')).toBe(3);
    expect(prevValueOf(iss('a', 's'), 'epicId')).toBeNull();
  });
  it('gom các việc đã cập nhật theo giá trị cũ để Hoàn tác mỗi giá trị một request', () => {
    const prev = new Map<string, string | number | null>([
      ['a', 3],
      ['b', 3],
      ['c', null],
    ]);
    const g = groupByPrev(
      [
        { id: 'a', version: 4 },
        { id: 'b', version: 4 },
        { id: 'c', version: 2 },
      ],
      prev,
    );
    expect([...g.entries()]).toEqual([
      [
        3,
        [
          { id: 'a', version: 4 },
          { id: 'b', version: 4 },
        ],
      ],
      [null, [{ id: 'c', version: 2 }]],
    ]);
  });
});

describe('labelsToUndo', () => {
  const withLabels = (id: string, ids: string[]) =>
    ({ id, labels: ids.map((x) => ({ id: x })) }) as unknown as IssueDto;
  it('chỉ gỡ nhãn khỏi những việc CHƯA có nhãn đó trước khi thêm', () => {
    const before = [withLabels('a', []), withLabels('b', ['l1']), withLabels('c', [])];
    const updated = [
      { id: 'a', version: 4 },
      { id: 'b', version: 4 },
      { id: 'c', version: 4 },
    ];
    expect(labelsToUndo(before, updated, 'l1')).toEqual([
      { id: 'a', version: 4 },
      { id: 'c', version: 4 },
    ]);
  });
  it('việc không nằm trong updated (conflict) không bị đụng', () => {
    expect(labelsToUndo([withLabels('a', [])], [], 'l1')).toEqual([]);
  });
});
