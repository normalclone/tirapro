import { describe, expect, it, vi } from 'vitest';
import {
  disabledRuleNotices,
  publishRuleChanges,
  rewriteRuleStatusRefs,
  ruleTypeScope,
  scopeFromPairs,
} from './rule-status-refs';

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Khi đang làm',
  projectId: null,
  createdById: 'u-rule',
  enabled: true,
  triggerConfig: { toStatusId: 'old1' },
  conditions: [],
  actions: [],
  ...over,
});

/** Trạng thái giả: tên = id viết hoa; quy trình: `std*` → wfStd, `bug*` → wfBug, `epic*` → wfEpic, còn lại wfOld. */
const WF = (id: string) =>
  id.startsWith('std')
    ? 'wfStd'
    : id.startsWith('bug')
      ? 'wfBug'
      : id.startsWith('epic')
        ? 'wfEpic'
        : 'wfOld';

function fakeDb(rules: Array<Record<string, unknown>>) {
  const rows = rules.map((r) => ({ ...r }));
  return {
    rows,
    db: {
      status: {
        findMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            a.where.id.in.map((id) => ({ id, name: id.toUpperCase(), workflowId: WF(id) })),
          ),
        ),
      },
      automationRule: {
        findMany: vi.fn(() => Promise.resolve(rows.map((r) => ({ ...r })))),
        update: vi.fn((a: { where: { id: string }; data: Record<string, unknown> }) => {
          Object.assign(rows.find((r) => r.id === a.where.id)!, a.data);
          return Promise.resolve({});
        }),
      },
    },
  };
}

describe('rewriteRuleStatusRefs — MỘT hàm cho script migrate và các endpoint quy trình', () => {
  it('map rỗng: không đọc DB', async () => {
    const { db } = fakeDb([rule()]);
    expect(await rewriteRuleStatusRefs(db as never, 'w1', new Map(), { dryRun: false })).toEqual({
      affectedRules: [],
    });
    expect(db.automationRule.findMany).not.toHaveBeenCalled();
  });

  it('dryRun: liệt kê quy tắc bị ảnh hưởng, KHÔNG ghi', async () => {
    const { db, rows } = fakeDb([rule()]);
    const out = await rewriteRuleStatusRefs(db as never, 'w1', new Map([['old1', ['new1']]]), {
      dryRun: true,
    });
    expect(out.affectedRules).toEqual([
      expect.objectContaining({ ruleId: 'r1', outcome: 'rewritten', wasEnabled: true }),
    ]);
    expect(db.automationRule.update).not.toHaveBeenCalled();
    expect(rows[0]!.triggerConfig).toEqual({ toStatusId: 'old1' });
  });

  it('chạy thật: ghi trigger/điều kiện/hành động; quy tắc không liên quan không bị ghi; chạy lại là no-op', async () => {
    const { db, rows } = fakeDb([
      rule({
        conditions: [{ field: 'statusId', op: 'eq', value: 'old1' }],
        actions: [{ type: 'transition', toStatusId: 'old1' }],
      }),
      rule({ id: 'r2', triggerConfig: { toStatusId: 'other' } }),
    ]);
    const map = new Map([['old1', ['new1']]]);
    const out = await rewriteRuleStatusRefs(db as never, 'w1', map, { dryRun: false });
    expect(out.affectedRules.map((r) => r.ruleId)).toEqual(['r1']);
    expect(rows[0]).toMatchObject({
      triggerConfig: { toStatusId: 'new1' },
      conditions: [{ field: 'statusId', op: 'eq', value: 'new1' }],
      actions: [{ type: 'transition', toStatusId: 'new1' }],
    });
    expect(rows[1]!.triggerConfig).toEqual({ toStatusId: 'other' });
    expect(db.automationRule.update).toHaveBeenCalledTimes(1);
    const again = await rewriteRuleStatusRefs(db as never, 'w1', map, { dryRun: false });
    expect(again.affectedRules).toEqual([]);
    expect(db.automationRule.update).toHaveBeenCalledTimes(1);
  });

  it('không ánh xạ được (đích rỗng): TẮT quy tắc, giữ nội dung gốc; dryRun chỉ báo', async () => {
    const { db, rows } = fakeDb([rule()]);
    const dry = await rewriteRuleStatusRefs(db as never, 'w1', new Map([['old1', []]]), {
      dryRun: true,
    });
    expect(dry.affectedRules[0]).toMatchObject({
      outcome: 'disabled',
      unmappableStatusIds: ['old1'],
    });
    expect(rows[0]!.enabled).toBe(true);
    await rewriteRuleStatusRefs(db as never, 'w1', new Map([['old1', []]]), { dryRun: false });
    expect(rows[0]).toMatchObject({ enabled: false, triggerConfig: { toStatusId: 'old1' } });
  });

  it('một id cũ → nhiều đích (mỗi quy trình một đích): trigger dùng toStatusIds', async () => {
    const { db, rows } = fakeDb([rule()]);
    await rewriteRuleStatusRefs(db as never, 'w1', new Map([['old1', ['a', 'b']]]), {
      dryRun: false,
    });
    expect(rows[0]!.triggerConfig).toEqual({ toStatusIds: ['a', 'b'] });
  });
});

describe('rewriteRuleStatusRefs — phạm vi quy tắc (không rộng sang quy trình không dùng) và báo trước → sau', () => {
  const map = new Map([['old1', ['std1', 'bug1', 'epic1']]]);

  it('dryRun báo từng quy tắc: tên, dự án, id/tên cũ → các id/tên mới', async () => {
    const { db } = fakeDb([rule({ projectId: 'p1' })]);
    const out = await rewriteRuleStatusRefs(db as never, 'w1', map, { dryRun: true });
    expect(out.affectedRules[0]).toMatchObject({
      name: 'Khi đang làm',
      projectId: 'p1',
      statusRefs: [
        {
          fromId: 'old1',
          fromName: 'OLD1',
          toIds: ['std1', 'bug1', 'epic1'],
          toNames: ['STD1', 'BUG1', 'EPIC1'],
        },
      ],
    });
  });

  it('scopeOf chỉ giữ đích ở quy trình phạm vi quy tắc dùng: quy tắc Standard không rộng sang Bug/Epic', async () => {
    const { db, rows } = fakeDb([rule()]);
    const out = await rewriteRuleStatusRefs(db as never, 'w1', map, {
      dryRun: false,
      scopeOf: () => new Set(['wfStd']),
    });
    expect(rows[0]!.triggerConfig).toEqual({ toStatusId: 'std1' });
    expect(out.affectedRules[0]!.statusRefs).toEqual([
      { fromId: 'old1', fromName: 'OLD1', toIds: ['std1'], toNames: ['STD1'] },
    ]);
  });

  it('phạm vi hai quy trình → đúng hai đích; không trúng đích nào → giữ đủ danh sách (không tắt quy tắc)', async () => {
    const a = fakeDb([rule()]);
    await rewriteRuleStatusRefs(a.db as never, 'w1', map, {
      dryRun: false,
      scopeOf: () => new Set(['wfStd', 'wfBug']),
    });
    expect(a.rows[0]!.triggerConfig).toEqual({ toStatusIds: ['std1', 'bug1'] });
    const b = fakeDb([rule()]);
    await rewriteRuleStatusRefs(b.db as never, 'w1', map, {
      dryRun: false,
      scopeOf: () => new Set(['wfNone']),
    });
    expect(b.rows[0]!.triggerConfig).toEqual({ toStatusIds: ['std1', 'bug1', 'epic1'] });
    expect(b.rows[0]!.enabled).toBe(true);
  });

  it('id cũ được giữ lại (còn việc ở quy trình cũ) không bị lọc bỏ khỏi phạm vi', async () => {
    const { db, rows } = fakeDb([rule()]);
    await rewriteRuleStatusRefs(db as never, 'w1', new Map([['old1', ['std1', 'old1']]]), {
      dryRun: false,
      scopeOf: () => new Set(['wfStd']),
    });
    expect(rows[0]!.triggerConfig).toEqual({ toStatusIds: ['std1', 'old1'] });
  });

  it('ruleTypeScope đọc điều kiện typeId eq/in; scopeFromPairs lọc đích theo loại', () => {
    expect(ruleTypeScope([{ field: 'typeId', op: 'eq', value: 't1' }])).toEqual(['t1']);
    expect(ruleTypeScope([{ field: 'typeId', op: 'in', value: ['t1', 't2'] }])).toEqual([
      't1',
      't2',
    ]);
    expect(ruleTypeScope([{ field: 'priorityId', op: 'eq', value: 'x' }])).toBeNull();
    const scope = scopeFromPairs([
      { typeId: 't1', toWorkflowId: 'wfStd' },
      { typeId: 't2', toWorkflowId: 'wfBug' },
    ]);
    expect(scope({ conditions: [{ field: 'typeId', op: 'eq', value: 't2' }] })).toEqual(
      new Set(['wfBug']),
    );
    expect(scope({ conditions: [] })).toEqual(new Set(['wfStd', 'wfBug']));
    expect(scope({ conditions: [{ field: 'typeId', op: 'eq', value: 'khác' }] })).toBeNull();
  });
});

describe('thông báo quy tắc bị tắt', () => {
  const disabled = {
    ruleId: 'r1',
    name: 'Khi đang làm',
    projectId: null,
    createdById: 'u-rule',
    wasEnabled: true,
    outcome: 'disabled' as const,
  };

  it('chỉ báo quy tắc ĐANG BẬT vừa bị tắt (đã tắt sẵn / chỉ sửa id thì không)', () => {
    expect(
      disabledRuleNotices('w1', [
        disabled,
        { ...disabled, ruleId: 'r2', wasEnabled: false },
        { ...disabled, ruleId: 'r3', outcome: 'rewritten' as const },
      ]),
    ).toEqual([
      { recipientId: 'u-rule', organizationId: 'w1', ruleId: 'r1', ruleName: 'Khi đang làm' },
    ]);
  });

  it('publishRuleChanges: phát sự kiện bỏ cache + publish force; không có gì thì im lặng; lỗi gửi chỉ ghi log', async () => {
    const events = { emit: vi.fn() };
    const publish = vi.fn(() => Promise.resolve());
    await publishRuleChanges(
      { events: events as never, notifications: { publish } as never },
      'w1',
      'actor',
      [],
    );
    expect(events.emit).not.toHaveBeenCalled();
    await publishRuleChanges(
      { events: events as never, notifications: { publish } as never },
      'w1',
      'actor',
      [disabled],
    );
    expect(events.emit).toHaveBeenCalledWith('automation.rules_changed', { organizationId: 'w1' });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'u-rule',
        type: 'ISSUE_UPDATED',
        payload: { automationRuleDisabled: 'Khi đang làm' },
      }),
      { force: true },
    );
    const boom = vi.fn(() => Promise.reject(new Error('x')));
    await expect(
      publishRuleChanges({ notifications: { publish: boom } as never }, 'w1', 'actor', [disabled]),
    ).resolves.toBeUndefined();
  });
});
