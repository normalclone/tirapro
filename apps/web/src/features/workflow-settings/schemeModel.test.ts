import { describe, expect, it } from 'vitest';
import type { WorkflowMoveRowDto } from '@tirapro/types';
import {
  buildFlatStatusMap,
  buildStatusMapByType,
  describeGroup,
  groupMoves,
  statusOptionsFor,
  targetOf,
  unmappedGroups,
} from './schemeModel';
import type { Workflow } from './api';

const row = (over: Partial<WorkflowMoveRowDto>): WorkflowMoveRowDto => ({
  projectId: 'p1',
  projectKey: 'KYHOP',
  issueTypeId: 't-bug',
  issueTypeName: 'Bug',
  fromStatusId: 'o-test',
  fromStatusName: 'Chờ test',
  toStatusId: 'b-retest',
  toStatusName: 'Ready for Retest',
  count: 8,
  suggested: true,
  ...over,
});

describe('schemeModel', () => {
  const moves = [
    row({}),
    row({ projectId: 'p2', projectKey: 'GSDA', count: 4 }),
    row({ issueTypeId: 't-task', issueTypeName: 'Task', toStatusId: null, toStatusName: null }),
  ];
  const groups = groupMoves(moves);

  it('gộp theo (loại việc, trạng thái cũ) qua mọi dự án, cộng số việc', () => {
    expect(groups).toHaveLength(2);
    const bug = groups.find((g) => g.typeId === 't-bug')!;
    expect(bug.total).toBe(12);
    expect(bug.projects).toEqual([
      { key: 'GSDA', count: 4 },
      { key: 'KYHOP', count: 8 },
    ]);
    expect(describeGroup(bug, 'Ready for Retest')).toBe(
      '12 Bug: Chờ test → Ready for Retest (GSDA 4, KYHOP 8)',
    );
  });

  it('lựa chọn của người dùng thắng gợi ý; nhóm chưa có đích bị chặn xác nhận', () => {
    const bug = groups.find((g) => g.typeId === 't-bug')!;
    const task = groups.find((g) => g.typeId === 't-task')!;
    expect(targetOf(bug, {})).toBe('b-retest');
    expect(targetOf(bug, { [bug.key]: 'b-doing' })).toBe('b-doing');
    expect(unmappedGroups(groups, {}).map((g) => g.typeId)).toEqual(['t-task']);
    expect(unmappedGroups(groups, { [task.key]: 's-doing' })).toEqual([]);
  });

  it('statusMapByType (tổ chức) tách theo loại; statusMap phẳng (dự án); bỏ nhóm chưa có đích', () => {
    const task = groups.find((g) => g.typeId === 't-task')!;
    expect(buildStatusMapByType(groups, {})).toEqual({ 't-bug': { 'o-test': 'b-retest' } });
    expect(buildStatusMapByType(groups, { [task.key]: 's-doing' })).toEqual({
      't-bug': { 'o-test': 'b-retest' },
      't-task': { 'o-test': 's-doing' },
    });
    expect(buildFlatStatusMap(groups.slice(0, 1), {})).toEqual({ 'o-test': 'b-retest' });
  });

  it('statusOptionsFor liệt kê trạng thái của quy trình chứa đích gợi ý (theo thứ tự), dự phòng theo quy trình đích', () => {
    const wfs = [
      {
        id: 'wfBug',
        statuses: [
          { id: 'b2', name: 'Done', order: 1 },
          { id: 'b-retest', name: 'Ready for Retest', order: 0 },
        ],
      },
      { id: 'wfStd', statuses: [{ id: 's1', name: 'To Do', order: 0 }] },
    ] as unknown as Workflow[];
    expect(statusOptionsFor(wfs, 'b-retest').map((o) => o.name)).toEqual([
      'Ready for Retest',
      'Done',
    ]);
    expect(statusOptionsFor(wfs, null, 'wfStd').map((o) => o.id)).toEqual(['s1']);
    expect(statusOptionsFor(wfs, null)).toEqual([]);
  });
});
