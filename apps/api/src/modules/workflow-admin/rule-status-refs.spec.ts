import { describe, expect, it, vi } from 'vitest';
import { disabledRuleNotices, publishRuleChanges, rewriteRuleStatusRefs } from './rule-status-refs';

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

function fakeDb(rules: Array<Record<string, unknown>>) {
  const rows = rules.map((r) => ({ ...r }));
  return {
    rows,
    db: {
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
      { recipientId: 'u-rule', workspaceId: 'w1', ruleId: 'r1', ruleName: 'Khi đang làm' },
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
    expect(events.emit).toHaveBeenCalledWith('automation.rules_changed', { workspaceId: 'w1' });
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
