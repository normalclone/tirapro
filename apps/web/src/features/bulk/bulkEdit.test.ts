import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type { Workflow } from '@/features/workflow-settings/api';
import {
  commonNextStatuses,
  groupByPrev,
  labelsToUndo,
  planBulkResult,
  bulkResultTitle,
  planRestoreField,
  prevValueOf,
  runUndoPlan,
  type VersionedItem,
} from './bulkEdit';

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

describe('planRestoreField (kế hoạch Hoàn tác: giá trị cũ vào → patch ngược ra)', () => {
  const targets = [
    iss('a', 'todo', { priority: { id: 'p-high' } as IssueDto['priority'] }),
    iss('b', 'todo', { priority: { id: 'p-high' } as IssueDto['priority'] }),
    iss('c', 'prog', { priority: null }),
  ];
  const updated = [
    { id: 'a', version: 8 },
    { id: 'b', version: 3 },
    { id: 'c', version: 5 },
  ];
  it('gom theo giá trị cũ, mỗi nhóm một patch, dùng version MỚI của máy chủ', () => {
    const plan = planRestoreField('priorityId', targets, updated)!;
    const byPatch = new Map(plan.map((p) => [JSON.stringify(p.patch), p.items]));
    expect(byPatch.get('{"priorityId":"p-high"}')).toEqual([
      { id: 'a', version: 8 },
      { id: 'b', version: 3 },
    ]);
    expect(byPatch.get('{"priorityId":null}')).toEqual([{ id: 'c', version: 5 }]);
  });
  it('chỉ hoàn tác những việc ĐÃ cập nhật (việc bị conflict không nằm trong updated)', () => {
    const plan = planRestoreField('statusId', targets, [{ id: 'b', version: 3 }])!;
    expect(plan).toEqual([{ items: [{ id: 'b', version: 3 }], patch: { statusId: 'todo' } }]);
  });
  it('canRestore từ chối một giá trị cũ → không hứa Hoàn tác (null)', () => {
    const plan = planRestoreField('statusId', targets, updated, (prev) => prev !== 'prog');
    expect(plan).toBeNull();
    expect(planRestoreField('statusId', targets, updated, () => true)).toHaveLength(2);
  });
});

describe('runUndoPlan (đếm việc chưa hoàn tác được)', () => {
  const plan = [
    { items: [{ id: 'a', version: 2 }], patch: { priorityId: 'x' } },
    {
      items: [
        { id: 'b', version: 2 },
        { id: 'c', version: 2 },
      ],
      patch: { priorityId: null },
    },
  ];
  it('mọi nhóm xong → không còn việc kẹt', async () => {
    const r = await runUndoPlan(plan, () => Promise.resolve({ conflicts: [], unsent: 0 }));
    expect(r).toEqual({ stuck: 0, unsent: 0, firstError: undefined });
  });
  it('409 một phần: cộng dồn số việc chưa hoàn tác được qua các nhóm', async () => {
    const send = (items: VersionedItem[]) =>
      Promise.resolve({ conflicts: items.slice(1), unsent: 0 });
    const r = await runUndoPlan(plan, send);
    expect(r.stuck).toBe(1); // nhóm 1: 0 kẹt; nhóm 2: 1 kẹt
  });
  it('nhóm sau lỗi mạng giữa chừng: nhớ lỗi đầu tiên và số việc chưa gửi', async () => {
    const boom = new Error('mạng');
    const r = await runUndoPlan(plan, (items) =>
      Promise.resolve({ conflicts: items, unsent: items.length, error: boom }),
    );
    expect(r.stuck).toBe(3);
    expect(r.unsent).toBe(3);
    expect(r.firstError).toBe(boom);
  });
});

describe('planBulkResult (kết quả một lần bulk → lựa chọn kế tiếp)', () => {
  const sel = new Set(['a', 'b', 'c', 'd']);
  const ids = (xs: string[]) => xs.map((id) => ({ id }));
  it('xong hết: bỏ chọn tất cả', () => {
    const r = planBulkResult({ updated: ids(['a', 'b', 'c', 'd']), conflicts: [] }, sel);
    expect(r.kind).toBe('all');
    expect([...r.retain]).toEqual([]);
  });
  it('một phần: giữ chọn đúng các việc CHƯA xong (conflict) để thử lại', () => {
    const r = planBulkResult({ updated: ids(['a', 'b']), conflicts: ids(['c', 'd']) }, sel);
    expect(r.kind).toBe('partial');
    expect([...r.retain].sort()).toEqual(['c', 'd']);
    expect(r.updatedCount).toBe(2);
    expect(r.conflictCount).toBe(2);
  });
  it('không việc nào xong: giữ nguyên lựa chọn, không phải "một phần"', () => {
    const r = planBulkResult({ updated: [], conflicts: ids(['a', 'b', 'c', 'd']) }, sel);
    expect(r.kind).toBe('none');
    expect([...r.retain].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('conflict không thuộc lựa chọn hiện tại (đã đổi lúc chờ) thì không kéo vào', () => {
    const r = planBulkResult({ updated: ids(['a']), conflicts: ids(['zz', 'b']) }, sel);
    expect([...r.retain]).toEqual(['b']);
  });
});

describe('bulkResultTitle', () => {
  it('xong hết: giữ câu cũ theo động từ', () => {
    expect(bulkResultTitle('chuyển', { kind: 'all', updatedCount: 3, conflictCount: 0 })).toBe(
      'Đã chuyển 3 việc.',
    );
  });
  it('một phần: "Đã cập nhật N việc · M việc chưa cập nhật được"', () => {
    expect(bulkResultTitle('chuyển', { kind: 'partial', updatedCount: 2, conflictCount: 1 })).toBe(
      'Đã cập nhật 2 việc · 1 việc chưa cập nhật được',
    );
  });
  it('không việc nào: nói thẳng', () => {
    expect(bulkResultTitle('chuyển', { kind: 'none', updatedCount: 0, conflictCount: 4 })).toBe(
      'Chưa cập nhật được việc nào (4 việc)',
    );
  });
});
