import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import {
  aggregateGroupResults,
  applyNotice,
  availableBulkActions,
  groupByProject,
  groupPermsFor,
  groupedBulkTitle,
  mapLimit,
  planConflictRefresh,
  conflictHint,
  planGroupedUndo,
  type GroupOutcome,
  type GroupPerms,
} from './groupedBulk';
import { planRestoreField } from './bulkEdit';

const iss = (id: string, projectId: string, extra: Partial<IssueDto> = {}) =>
  ({
    id,
    projectId,
    key: id.toUpperCase(),
    version: 1,
    priority: null,
    status: { id: 's1' },
    ...extra,
  }) as unknown as IssueDto;

describe('groupByProject', () => {
  const list = [iss('a', 'p1'), iss('b', 'p2'), iss('c', 'p1'), iss('d', 'p3')];
  it('chỉ lấy việc đang chọn, nhóm theo dự án, giữ thứ tự xuất hiện đầu tiên', () => {
    const g = groupByProject(list, new Set(['c', 'b', 'a']));
    expect(g.map((x) => x.projectId)).toEqual(['p1', 'p2']);
    expect(g[0]!.issues.map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('lựa chọn rỗng / id không có trong danh sách → không nhóm nào', () => {
    expect(groupByProject(list, new Set())).toEqual([]);
    expect(groupByProject(list, new Set(['zz']))).toEqual([]);
  });
});

const all: GroupPerms = { canAssign: true, canEdit: true, canTransition: true };
const none: GroupPerms = { canAssign: false, canEdit: false, canTransition: false };

describe('availableBulkActions (hành động nào áp được khi chọn trải nhiều dự án)', () => {
  const one = [{ projectId: 'p1', count: 3, perms: all }];
  const two = [
    { projectId: 'p1', count: 3, perms: all },
    { projectId: 'p2', count: 2, perms: all },
  ];
  it('một dự án: mọi hành động hiện', () => {
    const a = availableBulkActions(one);
    for (const id of ['assignMe', 'assign', 'priority', 'points', 'label', 'status'] as const)
      expect(a[id].visible, id).toBe(true);
    expect(a.status.applyCount).toBe(3);
  });
  it('nhiều dự án: chỉ hành động xuyên dự án (Gán cho tôi, Ưu tiên, Điểm); Đổi người/Nhãn/Trạng thái ẩn', () => {
    const a = availableBulkActions(two);
    expect(a.assignMe.visible && a.priority.visible && a.points.visible).toBe(true);
    expect(a.assign.visible).toBe(false); // người chọn được khác nhau theo dự án
    expect(a.label.visible).toBe(false); // nhãn thuộc từng dự án
    expect(a.status.visible).toBe(false); // workflow theo dự án
    expect(a.priority.applyCount).toBe(5);
  });
  it('thiếu quyền ở một dự án: vẫn hiện, áp cho dự án có quyền, đếm việc bị bỏ qua', () => {
    const a = availableBulkActions([
      { projectId: 'p1', count: 5, perms: all },
      { projectId: 'p2', count: 2, perms: { ...all, canAssign: false } },
    ]);
    expect(a.assignMe.visible).toBe(true);
    expect(a.assignMe.applyProjectIds).toEqual(['p1']);
    expect(a.assignMe.applyCount).toBe(5);
    expect(a.assignMe.skipCount).toBe(2);
    expect(a.priority.skipCount).toBe(0);
  });
  it('không dự án nào có quyền → ẩn; mỗi nhóm quyền độc lập (gán / sửa / chuyển trạng thái)', () => {
    const a = availableBulkActions([{ projectId: 'p1', count: 2, perms: none }]);
    expect(Object.values(a).every((x) => !x.visible)).toBe(true);
    const b = availableBulkActions([
      {
        projectId: 'p1',
        count: 2,
        perms: { canAssign: false, canEdit: true, canTransition: false },
      },
    ]);
    expect(b.priority.visible).toBe(true);
    expect(b.points.visible).toBe(true);
    expect(b.label.visible).toBe(true);
    expect(b.assignMe.visible).toBe(false);
    expect(b.status.visible).toBe(false);
  });
  it('lựa chọn rỗng → không gì hiện', () => {
    expect(Object.values(availableBulkActions([])).every((x) => !x.visible)).toBe(true);
  });
});

describe('applyNotice (nói số việc áp được TRƯỚC khi chạy)', () => {
  it('có việc bị bỏ qua → nêu mọi lý do (thiếu quyền, lưu trữ, việc của người khác)', () => {
    const a = availableBulkActions([
      { projectId: 'p1', count: 5, perms: all },
      { projectId: 'p2', count: 2, perms: none },
    ]);
    expect(applyNotice(a.priority)).toBe(
      'Áp cho 5/7 việc (2 việc không áp được: thiếu quyền, dự án đã lưu trữ hoặc việc của người khác)',
    );
  });
  it('áp hết → không cần nhắc', () => {
    const a = availableBulkActions([{ projectId: 'p1', count: 5, perms: all }]);
    expect(applyNotice(a.priority)).toBeNull();
  });
});

describe('groupPermsFor', () => {
  const ws = (p: string[]) => ({ isSystemAdmin: false, workspace: p, project: undefined });
  it('quyền theo dự án; sửa phải được MỌI việc trong nhóm', () => {
    const issues = [iss('a', 'p1', { reporterId: 'me' }), iss('b', 'p1', { reporterId: 'other' })];
    const base = { archived: false, issues, userId: 'me' };
    expect(groupPermsFor({ ...base, ctx: ws(['issue:edit', 'issue:assign']) })).toEqual({
      canAssign: true,
      canEdit: true,
      canTransition: false,
    });
    // chỉ sửa việc của mình → không đủ cho cả nhóm
    expect(groupPermsFor({ ...base, ctx: ws(['issue:edit:own']) }).canEdit).toBe(false);
    expect(
      groupPermsFor({ ...base, issues: [issues[0]!], ctx: ws(['issue:edit:own']) }).canEdit,
    ).toBe(true);
  });
  it('dự án đã lưu trữ → chỉ đọc, mọi hành động tắt (kể cả quản trị)', () => {
    const p = groupPermsFor({
      ctx: { isSystemAdmin: true, workspace: [], project: undefined },
      archived: true,
      issues: [iss('a', 'p1')],
      userId: 'me',
    });
    expect(p).toEqual(none);
  });
});

describe('mapLimit', () => {
  it('giữ thứ tự kết quả và không chạy quá giới hạn song song', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1], 2, async (ms) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return ms * 2;
    });
    expect(out).toEqual([60, 10, 40, 2]);
    expect(peak).toBe(2);
  });
  it('danh sách rỗng → []', async () => {
    expect(await mapLimit([], 2, () => Promise.resolve(1))).toEqual([]);
  });
});

describe('aggregateGroupResults / groupedBulkTitle', () => {
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const keyOf = (id: string) => id.toUpperCase();
  const ok = (projectId: string, ids: string[], conflictIds: string[] = []): GroupOutcome => ({
    projectId,
    ok: true,
    updated: ids.map((id) => iss(id, projectId, { version: 2 })),
    conflictIds,
    unsentIds: [],
  });
  it('mọi nhóm xong: không giữ chọn, tiêu đề nêu số dự án', () => {
    const agg = aggregateGroupResults([ok('p1', ['a', 'b']), ok('p2', ['c'])], reason);
    expect(agg.updated.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect([...agg.retainIds]).toEqual([]);
    expect(agg.projectsUpdated).toBe(2);
    expect(agg.kind).toBe('all');
    expect(groupedBulkTitle('chuyển', agg, keyOf)).toBe('Đã chuyển 3 việc ở 2 dự án.');
  });
  it('một dự án: không nhắc "ở 1 dự án"', () => {
    const agg = aggregateGroupResults([ok('p1', ['a'])], reason);
    expect(groupedBulkTitle('gắn nhãn cho', agg, keyOf)).toBe('Đã gắn nhãn cho 1 việc.');
  });
  it('một nhóm lỗi hẳn: giữ chọn mọi việc của nhóm đó, tiêu đề nêu dự án lỗi + lý do', () => {
    const agg = aggregateGroupResults(
      [
        ok('p1', ['a', 'b', 'c', 'd', 'e', 'f', 'g']),
        { projectId: 'p2', ok: false, ids: ['x', 'y'], error: new Error('Không có quyền') },
      ],
      reason,
    );
    expect(agg.kind).toBe('partial');
    expect([...agg.retainIds].sort()).toEqual(['x', 'y']);
    expect(agg.failedProjects).toEqual([{ projectId: 'p2', reason: 'Không có quyền' }]);
    expect(groupedBulkTitle('chuyển', agg, keyOf)).toBe(
      'Đã cập nhật 7 việc ở 1 dự án · 1 dự án lỗi: P2 — Không có quyền',
    );
  });
  it('conflict trong nhóm xong: giữ chọn id conflict, nêu số việc chưa cập nhật được', () => {
    const agg = aggregateGroupResults([ok('p1', ['a'], ['b', 'c'])], reason);
    expect(agg.kind).toBe('partial');
    expect([...agg.retainIds].sort()).toEqual(['b', 'c']);
    expect(groupedBulkTitle('chuyển', agg, keyOf)).toBe(
      'Đã cập nhật 1 việc ở 1 dự án · 2 việc chưa cập nhật được',
    );
  });
  it('không việc nào xong: giữ nguyên lựa chọn, tiêu đề nói thẳng', () => {
    const agg = aggregateGroupResults(
      [{ projectId: 'p1', ok: false, ids: ['a', 'b'], error: new Error('Lỗi mạng') }],
      reason,
    );
    expect(agg.kind).toBe('none');
    expect([...agg.retainIds].sort()).toEqual(['a', 'b']);
    expect(groupedBulkTitle('chuyển', agg, keyOf)).toBe(
      'Chưa cập nhật được việc nào · 1 dự án lỗi: P1 — Lỗi mạng',
    );
  });
  it('lô sau lỗi giữa chừng (mạng): phần chưa gửi giữ chọn, được đếm RIÊNG khỏi conflict, kèm lỗi đầu tiên', () => {
    const boom = new Error('Mất mạng');
    const o: GroupOutcome = {
      projectId: 'p1',
      ok: true,
      updated: [iss('a', 'p1')],
      conflictIds: ['c'],
      unsentIds: ['b', 'd'],
      error: boom,
    };
    const agg = aggregateGroupResults([o], reason);
    expect(agg.kind).toBe('partial');
    expect([...agg.retainIds].sort()).toEqual(['b', 'c', 'd']);
    expect(agg.conflictCount).toBe(1);
    expect(agg.editedConflictIds).toEqual(['c']); // chỉ việc bị sửa trước mới cần tải lại bản mới
    expect(agg.unsentCount).toBe(2);
    expect(agg.firstError).toBe(boom);
    expect(groupedBulkTitle('chuyển', agg, keyOf)).toBe(
      'Đã cập nhật 1 việc ở 1 dự án · 3 việc chưa cập nhật được',
    );
  });
  it('"bỏ qua" (thiếu quyền/lưu trữ/việc của người khác) được nêu trong toast kết quả', () => {
    const agg = aggregateGroupResults([ok('p1', ['a', 'b'])], reason);
    expect(groupedBulkTitle('chuyển', agg, keyOf, 3)).toBe('Đã chuyển 2 việc · 3 việc bỏ qua.');
    const part = aggregateGroupResults(
      [ok('p1', ['a']), { projectId: 'p2', ok: false, ids: ['x'], error: new Error('Lỗi') }],
      reason,
    );
    expect(groupedBulkTitle('chuyển', part, keyOf, 2)).toBe(
      'Đã cập nhật 1 việc ở 1 dự án · 1 dự án lỗi: P2 — Lỗi · 2 việc bỏ qua',
    );
    const none = aggregateGroupResults(
      [{ projectId: 'p1', ok: false, ids: ['a'], error: new Error('Lỗi') }],
      reason,
    );
    expect(groupedBulkTitle('chuyển', none, keyOf, 1)).toBe(
      'Chưa cập nhật được việc nào · 1 dự án lỗi: P1 — Lỗi · 1 việc bỏ qua',
    );
  });
});

describe('planConflictRefresh / conflictHint (thử lại sau 409 phải dùng version MỚI)', () => {
  const fresh = (id: string, version: number) => iss(id, 'p1', { version });
  it('tách bản đã tải lại được khỏi những id tải lỗi', () => {
    const r = planConflictRefresh([
      { id: 'a', issue: fresh('a', 7) },
      { id: 'b', issue: null },
      { id: 'c', issue: fresh('c', 9) },
    ]);
    expect(r.fresh.map((i) => [i.id, i.version])).toEqual([
      ['a', 7],
      ['c', 9],
    ]);
    expect(r.failedIds).toEqual(['b']);
  });
  it('không có gì để tải lại → rỗng', () => {
    expect(planConflictRefresh([])).toEqual({ fresh: [], failedIds: [] });
  });
  it('gợi ý trung thực: đã cập nhật dòng theo bản mới / không tải lại được thì bảo chạy lại truy vấn', () => {
    expect(conflictHint({ refreshed: 2, refreshFailed: 0, unsent: 0 })).toBe(
      'Người khác vừa sửa 2 việc — dòng đã cập nhật theo bản mới, kiểm tra rồi thử lại.',
    );
    expect(conflictHint({ refreshed: 0, refreshFailed: 1, unsent: 0 })).toBe(
      'Không tải lại được 1 việc — hãy chạy lại truy vấn để lấy bản mới.',
    );
    expect(conflictHint({ refreshed: 1, refreshFailed: 1, unsent: 0 })).toBe(
      'Người khác vừa sửa 1 việc — dòng đã cập nhật theo bản mới, kiểm tra rồi thử lại. Không tải lại được 1 việc — hãy chạy lại truy vấn để lấy bản mới.',
    );
  });
  it('lỗi giữa chừng KHÔNG bị báo là "người khác vừa sửa"', () => {
    const h = conflictHint({ refreshed: 0, refreshFailed: 0, unsent: 3, rejection: null });
    expect(h).toBe('Một số việc chưa gửi được — thử lại.');
    expect(h).not.toContain('Người khác');
    expect(
      conflictHint({ refreshed: 0, refreshFailed: 0, unsent: 2, rejection: 'Bị từ chối' }),
    ).toBe('Bị từ chối');
    expect(conflictHint({ refreshed: 1, refreshFailed: 0, unsent: 2 })).toBe(
      'Một số việc chưa gửi được. Người khác vừa sửa 1 việc — dòng đã cập nhật theo bản mới, kiểm tra rồi thử lại.',
    );
  });
  it('không có việc chưa xong → không có gợi ý', () => {
    expect(conflictHint({ refreshed: 0, refreshFailed: 0, unsent: 0 })).toBeUndefined();
  });
});

describe('planGroupedUndo (Hoàn tác theo nhóm dự án)', () => {
  const targets = [
    iss('a', 'p1', { priority: { id: 'hi' } as IssueDto['priority'] }),
    iss('b', 'p1', { priority: null }),
    iss('c', 'p2', { priority: { id: 'lo' } as IssueDto['priority'] }),
  ];
  const groups = [
    { projectId: 'p1', issues: [targets[0]!, targets[1]!] },
    { projectId: 'p2', issues: [targets[2]!] },
  ];
  const build = (t: IssueDto[], u: Array<{ id: string; version: number }>) =>
    planRestoreField('priorityId', t, u);
  it('mỗi dự án một kế hoạch riêng, gắn projectId, dùng version MỚI của máy chủ', () => {
    const plan = planGroupedUndo(
      groups,
      new Map([
        [
          'p1',
          [
            { id: 'a', version: 5 },
            { id: 'b', version: 7 },
          ],
        ],
        ['p2', [{ id: 'c', version: 3 }]],
      ]),
      build,
    )!;
    expect(plan.map((s) => s.projectId).sort()).toEqual(['p1', 'p1', 'p2']);
    const p2 = plan.find((s) => s.projectId === 'p2')!;
    expect(p2.items).toEqual([{ id: 'c', version: 3 }]);
    expect(p2.patch).toEqual({ priorityId: 'lo' });
  });
  it('nhóm không có việc nào cập nhật được thì không có bước Hoàn tác cho nhóm đó', () => {
    const plan = planGroupedUndo(groups, new Map([['p1', [{ id: 'a', version: 5 }]]]), build)!;
    expect(plan.every((s) => s.projectId === 'p1')).toBe(true);
  });
  it('không việc nào xong → null (không hứa Hoàn tác)', () => {
    expect(planGroupedUndo(groups, new Map(), build)).toBeNull();
  });
  it('một nhóm không đảo được → null cả kế hoạch', () => {
    const only = (t: IssueDto[], u: Array<{ id: string; version: number }>) =>
      t[0]!.projectId === 'p2' ? null : build(t, u);
    expect(
      planGroupedUndo(
        groups,
        new Map([
          ['p1', [{ id: 'a', version: 5 }]],
          ['p2', [{ id: 'c', version: 3 }]],
        ]),
        only,
      ),
    ).toBeNull();
  });
});
