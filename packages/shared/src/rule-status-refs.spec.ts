import { describe, expect, it } from 'vitest';
import {
  buildNotificationTitle,
  remapRuleStatusIds,
  ruleActionSchema,
  triggerConfigSchema,
} from './index';

const map = (entries: Array<[string, string[]]>) => new Map(entries);
const rule = (over: Partial<Record<'triggerConfig' | 'conditions' | 'actions', unknown>> = {}) => ({
  triggerConfig: {},
  conditions: [],
  actions: [{ type: 'addComment', body: 'x' }],
  ...over,
});

describe('remapRuleStatusIds', () => {
  it('không tham chiếu trạng thái nào / id không có trong map: không đụng, touched=false', () => {
    const r = rule({
      triggerConfig: { toStatusId: 'other' },
      conditions: [{ field: 'priorityId', op: 'eq', value: 'o1' }],
    });
    const out = remapRuleStatusIds(r, map([['o1', ['n1']]]));
    expect(out.touched).toBe(false);
    expect(out.triggerConfig).toEqual({ toStatusId: 'other' });
    expect(out.conditions).toEqual(r.conditions); // field khác statusId không bị đổi dù value trùng id
  });

  it('trigger toStatusId: một đích → thay id; nhiều đích → chuyển sang toStatusIds (khớp bất kỳ)', () => {
    expect(
      remapRuleStatusIds(rule({ triggerConfig: { toStatusId: 'o1' } }), map([['o1', ['n1']]]))
        .triggerConfig,
    ).toEqual({ toStatusId: 'n1' });
    const multi = remapRuleStatusIds(
      rule({ triggerConfig: { toStatusId: 'o1', cron: 'x' } }),
      map([['o1', ['n1', 'n2']]]),
    );
    expect(multi.triggerConfig).toEqual({ cron: 'x', toStatusIds: ['n1', 'n2'] });
    expect(multi.touched).toBe(true);
  });

  it('trigger toStatusIds sẵn có: mỗi phần tử được thay, khử trùng', () => {
    const out = remapRuleStatusIds(
      rule({ triggerConfig: { toStatusIds: ['o1', 'n1'] } }),
      map([['o1', ['n1', 'n2']]]),
    );
    expect(out.triggerConfig).toEqual({ toStatusIds: ['n1', 'n2'] });
  });

  it('điều kiện statusId: eq/neq một đích giữ toán tử; nhiều đích → in/nin; in/nin thay từng phần tử', () => {
    const m = map([
      ['o1', ['n1']],
      ['o2', ['n2', 'n3']],
    ]);
    const out = remapRuleStatusIds(
      rule({
        conditions: [
          { field: 'statusId', op: 'eq', value: 'o1' },
          { field: 'statusId', op: 'eq', value: 'o2' },
          { field: 'statusId', op: 'neq', value: 'o2' },
          { field: 'statusId', op: 'in', value: ['o1', 'o2', 'x'] },
          { field: 'statusId', op: 'nin', value: ['o1'] },
          { field: 'statusId', op: 'notEmpty' },
          { jql: 'status = "Done"' },
        ],
      }),
      m,
    );
    expect(out.conditions).toEqual([
      { field: 'statusId', op: 'eq', value: 'n1' },
      { field: 'statusId', op: 'in', value: ['n2', 'n3'] },
      { field: 'statusId', op: 'nin', value: ['n2', 'n3'] },
      { field: 'statusId', op: 'in', value: ['n1', 'n2', 'n3', 'x'] },
      { field: 'statusId', op: 'nin', value: ['n1'] },
      { field: 'statusId', op: 'notEmpty' },
      { jql: 'status = "Done"' },
    ]);
  });

  it('hành động transition: đích đầu là chính, còn lại vào alsoStatusIds', () => {
    const one = remapRuleStatusIds(
      rule({ actions: [{ type: 'transition', toStatusId: 'o1' }] }),
      map([['o1', ['n1']]]),
    );
    expect(one.actions).toEqual([{ type: 'transition', toStatusId: 'n1' }]);
    const many = remapRuleStatusIds(
      rule({
        actions: [
          { type: 'transition', toStatusId: 'o1' },
          { type: 'addComment', body: 'x' },
        ],
      }),
      map([['o1', ['n1', 'n2', 'n3']]]),
    );
    expect(many.actions).toEqual([
      { type: 'transition', toStatusId: 'n1', alsoStatusIds: ['n2', 'n3'] },
      { type: 'addComment', body: 'x' },
    ]);
  });

  it('có thể giữ cả id cũ làm đích (quy trình cũ còn việc): id cũ nằm trong danh sách đích', () => {
    const out = remapRuleStatusIds(
      rule({ triggerConfig: { toStatusId: 'o1' } }),
      map([['o1', ['n1', 'o1']]]),
    );
    expect(out.triggerConfig).toEqual({ toStatusIds: ['n1', 'o1'] });
  });

  it('danh sách đích RỖNG = không ánh xạ được: unmappable, nội dung giữ nguyên', () => {
    const r = rule({
      triggerConfig: { toStatusId: 'gone' },
      actions: [{ type: 'transition', toStatusId: 'o1' }],
    });
    const out = remapRuleStatusIds(
      r,
      map([
        ['gone', []],
        ['o1', ['n1']],
      ]),
    );
    expect(out).toMatchObject({ touched: true, unmappable: ['gone'] });
    expect(out.triggerConfig).toEqual({ toStatusId: 'gone' });
    expect(out.actions).toEqual(r.actions); // không đổi nửa vời
  });

  it('idempotent: chạy lại trên kết quả (id mới không có trong map) không đổi gì', () => {
    const m = map([['o1', ['n1', 'n2']]]);
    const first = remapRuleStatusIds(
      rule({
        triggerConfig: { toStatusId: 'o1' },
        actions: [{ type: 'transition', toStatusId: 'o1' }],
      }),
      m,
    );
    const again = remapRuleStatusIds(first, m);
    expect(again.touched).toBe(false);
    expect(again.triggerConfig).toEqual(first.triggerConfig);
    expect(again.actions).toEqual(first.actions);
  });

  it('kết quả vẫn qua zod của quy tắc (toStatusIds / alsoStatusIds được schema nhận, không bị bỏ)', () => {
    const out = remapRuleStatusIds(
      rule({
        triggerConfig: { toStatusId: 'o1' },
        actions: [{ type: 'transition', toStatusId: 'o1' }],
      }),
      map([['o1', ['n1', 'n2']]]),
    );
    expect(triggerConfigSchema.parse(out.triggerConfig)).toEqual({ toStatusIds: ['n1', 'n2'] });
    expect(ruleActionSchema.parse((out.actions as unknown[])[0])).toEqual({
      type: 'transition',
      toStatusId: 'n1',
      alsoStatusIds: ['n2'],
    });
  });
});

describe('buildNotificationTitle — quy tắc bị tắt', () => {
  it('ISSUE_UPDATED không gắn việc nêu tên quy tắc', () => {
    expect(
      buildNotificationTitle('ISSUE_UPDATED', { automationRuleDisabled: 'Báo khi xong' }),
    ).toBe('Quy tắc “Báo khi xong” đã tắt vì trạng thái không còn — hãy mở quy tắc để chọn lại');
  });
});
