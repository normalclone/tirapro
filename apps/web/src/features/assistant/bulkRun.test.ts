import { describe, expect, it, vi } from 'vitest';
import type {
  AssistantBulkAssignResult,
  AssistantBulkAssignRowInput,
  AssistantBulkMemberRowInput,
  AssistantBulkMembersResult,
} from '@tirapro/types';
import {
  SKIP,
  initialAssignState,
  initialMemberState,
  type AssignCard,
  type MemberCard,
} from './bulkPreview';
import { runConfirm, runUndo } from './bulkRun';

const P = (id: string) => ({ id, name: id, email: `${id}@x.vn` });
const row = (n: number, over: Record<string, unknown> = {}) => ({
  issueId: `i${n}`,
  key: `DEMO-${n}`,
  summary: `Việc ${n}`,
  version: n,
  projectId: 'p1',
  projectKey: 'DEMO',
  current: null,
  points: null,
  allowed: true as boolean | undefined,
  ...over,
});
const card = (over: Partial<AssignCard> = {}): AssignCard => ({
  kind: 'assign',
  rows: [row(1), row(2), row(3)],
  slots: [{ query: 'Linh', person: P('u-linh'), options: null }],
  unmatched: [],
  modes: ['one'],
  defaultMode: 'one',
  loads: {},
  filterNotes: [],
  filterJql: null,
  truncated: false,
  missingKeys: [],
  notes: [],
  problems: [],
  ...over,
});

function exec() {
  const assign = vi.fn(
    (rows: AssistantBulkAssignRowInput[]): Promise<AssistantBulkAssignResult> =>
      Promise.resolve({
        results: rows.map((r) => ({
          issueId: r.issueId,
          key: null,
          status: 'ok' as const,
          previousAssigneeId: 'old',
          assigneeId: r.assigneeId,
          version: r.version + 1,
        })),
      }),
  );
  const members = vi.fn(
    (rows: AssistantBulkMemberRowInput[]): Promise<AssistantBulkMembersResult> =>
      Promise.resolve({
        results: rows.map((r) => ({
          projectId: r.projectId,
          userId: r.userId,
          status: 'ok' as const,
          before: r.expect,
          after: r.set,
        })),
      }),
  );
  return { assign, members };
}

describe('runConfirm — giao việc', () => {
  it('chỉ gửi dòng ok: dòng bỏ / không đủ quyền / đã đúng người KHÔNG BAO GIỜ đi ra máy chủ', async () => {
    const e = exec();
    const c = card({
      rows: [row(1), row(2), row(3, { allowed: false }), row(4, { current: P('u-linh') })],
    });
    const out = await runConfirm(c, { ...initialAssignState(c), overrides: { i2: SKIP } }, e);
    expect(e.assign).toHaveBeenCalledTimes(1);
    expect(e.assign.mock.calls[0]![0]).toEqual([
      { issueId: 'i1', version: 1, assigneeId: 'u-linh' },
    ]);
    expect(e.members).not.toHaveBeenCalled();
    expect(out.counts.ok).toBe(1);
  });

  it('TỪ CHỐI (không gọi máy chủ) khi chưa xác nhận được: tên mơ hồ chưa chọn, lỗi chặn, không có dòng nào', async () => {
    const e = exec();
    const ambiguous = card({ slots: [{ query: 'Thuỷ', person: null, options: [P('a'), P('b')] }] });
    await expect(runConfirm(ambiguous, initialAssignState(ambiguous), e)).rejects.toThrow(
      /chưa đủ điều kiện/,
    );
    const bad = card({ problems: ['xung đột'] });
    await expect(runConfirm(bad, initialAssignState(bad), e)).rejects.toThrow();
    const empty = card({ rows: [row(1, { allowed: false })] });
    await expect(runConfirm(empty, initialAssignState(empty), e)).rejects.toThrow();
    expect(e.assign).not.toHaveBeenCalled();
  });

  it('lỗi một phần từ máy chủ: kết quả từng dòng + Hoàn tác CHỈ của dòng đã đổi', async () => {
    const e = {
      ...exec(),
      assign: vi.fn((rows: AssistantBulkAssignRowInput[]) =>
        Promise.resolve({
          results: rows.map((r) =>
            r.issueId === 'i2'
              ? {
                  issueId: 'i2',
                  key: 'DEMO-2',
                  status: 'failed' as const,
                  reason: 'Dự án đã lưu trữ',
                  previousAssigneeId: null,
                  assigneeId: null,
                  version: 2,
                }
              : r.issueId === 'i3'
                ? {
                    issueId: 'i3',
                    key: 'DEMO-3',
                    status: 'skipped' as const,
                    reason: 'Việc đã được sửa',
                    previousAssigneeId: null,
                    assigneeId: null,
                    version: 9,
                  }
                : {
                    issueId: r.issueId,
                    key: 'DEMO-1',
                    status: 'ok' as const,
                    previousAssigneeId: 'old',
                    assigneeId: r.assigneeId,
                    version: 2,
                  },
          ),
        }),
      ),
    };
    const c = card();
    const out = await runConfirm(c, initialAssignState(c), e);
    expect(out.counts).toEqual({ ok: 1, skipped: 1, failed: 1 });
    expect(out.undo).toMatchObject({
      kind: 'assign',
      rows: [{ issueId: 'i1', version: 2, assigneeId: 'old' }],
    });
    // Hoàn tác: gửi đúng một dòng đó, không đụng dòng lỗi/bỏ qua.
    const undoExec = exec();
    const undone = await runUndo(out.undo!, undoExec);
    expect(undoExec.assign.mock.calls[0]![0]).toEqual([
      { issueId: 'i1', version: 2, assigneeId: 'old' },
    ]);
    expect(undone.counts.ok).toBe(1);
    expect(undone.undo).toBeNull();
  });

  it('lỗi gọi máy chủ → ném lỗi (thẻ sang "failed"), không tạo kết quả giả', async () => {
    const e = { ...exec(), assign: vi.fn(() => Promise.reject(new Error('mạng'))) };
    const c = card();
    await expect(runConfirm(c, initialAssignState(c), e)).rejects.toThrow('mạng');
  });
});

describe('runConfirm / runUndo — thành viên', () => {
  const mcard = (): MemberCard => ({
    kind: 'add-member',
    slots: [{ query: 'Linh', person: P('u-linh'), options: null }],
    unmatched: [],
    projects: [
      { id: 'p1', key: 'DEMO', name: 'Demo', isPrivate: false, allowed: true, members: {} },
      { id: 'p2', key: 'ZED', name: 'Zed', isPrivate: false, allowed: false, members: {} },
    ],
    groupName: null,
    roles: [{ id: 'r-tester', name: 'Tester' }],
    defaultRole: { id: 'r-tester', source: 'parsed', query: 'Tester' },
    info: [],
    notes: [],
    problems: [],
  });
  it('chỉ gửi dòng project:admin hợp lệ; Hoàn tác = đảo đúng trạng thái trước/sau của dòng đã đổi', async () => {
    const e = exec();
    const c = mcard();
    const out = await runConfirm(c, initialMemberState(c), e);
    expect(e.members.mock.calls[0]![0]).toEqual([
      { projectId: 'p1', userId: 'u-linh', expect: null, set: ['r-tester'] },
    ]);
    expect(out.undo).toMatchObject({
      kind: 'members',
      rows: [{ projectId: 'p1', userId: 'u-linh', expect: ['r-tester'], set: null }],
    });
    const undoExec = exec();
    await runUndo(out.undo!, undoExec);
    expect(undoExec.members.mock.calls[0]![0]).toEqual([
      { projectId: 'p1', userId: 'u-linh', expect: ['r-tester'], set: null },
    ]);
    expect(undoExec.assign).not.toHaveBeenCalled();
  });
  it('thêm mà chưa chọn vai trò → từ chối', async () => {
    const e = exec();
    const c = { ...mcard(), defaultRole: { id: null, source: 'none' as const } };
    await expect(runConfirm(c, initialMemberState(c), e)).rejects.toThrow();
    expect(e.members).not.toHaveBeenCalled();
  });
});
