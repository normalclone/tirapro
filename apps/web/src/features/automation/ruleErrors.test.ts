import { describe, expect, it } from 'vitest';
import {
  RULE_ACTIONS_ID,
  RULE_CONDITIONS_ID,
  RULE_NAME_ID,
  RULE_TRIGGER_ID,
  actionFieldId,
  conditionFieldId,
  conditionJqlId,
  ruleIssueToFieldError,
  validateRulePayload,
  type RuleDraftIds,
} from './ruleErrors';

const ids: RuleDraftIds = { conditions: ['c1', 'c2'], actions: ['a1', 'a2', 'a3'] };

const valid = {
  name: 'Việc khẩn giao cho lead',
  projectId: null,
  trigger: 'ISSUE_CREATED',
  triggerConfig: {},
  conditions: [],
  actions: [{ type: 'assign', mode: 'lead' }],
};

describe('id trường của biên tập quy tắc', () => {
  it('ổn định theo id hàng nháp (không theo chỉ số) và không trùng nhau', () => {
    expect(conditionFieldId('c1')).toBe('rule-cond-c1');
    expect(conditionJqlId('c1')).toBe('rule-cond-c1-jql');
    expect(actionFieldId('a2', 'url')).toBe('rule-act-a2-url');
    const all = [
      RULE_NAME_ID,
      RULE_TRIGGER_ID,
      RULE_CONDITIONS_ID,
      RULE_ACTIONS_ID,
      conditionFieldId('c1'),
      conditionJqlId('c1'),
      actionFieldId('c1', 'url'),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('validateRulePayload', () => {
  it('quy tắc hợp lệ → ok, trả đúng dữ liệu đã parse (payload không đổi)', () => {
    const r = validateRulePayload(valid, ids);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe('Việc khẩn giao cho lead');
      expect(r.data.actions).toEqual([{ type: 'assign', mode: 'lead' }]);
    }
  });

  it('thiếu tên → lỗi ở ô tên với câu tiếng Việt của schema', () => {
    const r = validateRulePayload({ ...valid, name: '   ' }, ids);
    expect(r).toEqual({
      ok: false,
      errors: [{ id: 'rule-name', label: 'Tên quy tắc', message: 'Hãy đặt tên cho quy tắc' }],
    });
  });

  it('trả MỌI lỗi một lượt theo thứ tự xuất hiện trong trang: tên → điều kiện → hành động', () => {
    const r = validateRulePayload(
      {
        ...valid,
        name: '',
        conditions: [{ field: 'priorityId', op: 'eq', value: 'p1' }, { jql: '' }],
        actions: [
          { type: 'webhook', url: '' },
          { type: 'assign', mode: 'user' },
          { type: 'notify', userIds: [], roles: [], message: '' },
        ],
      },
      ids,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.id)).toEqual([
      'rule-name',
      'rule-cond-c2-jql',
      'rule-act-a1-url',
      'rule-act-a2-userId',
      'rule-act-a3-message',
      'rule-act-a3-userIds',
    ]);
  });

  it('trong một hành động, lỗi xếp theo thứ tự ô (thông báo: nội dung trước người nhận)', () => {
    const r = validateRulePayload(
      { ...valid, actions: [{ type: 'notify', userIds: [], roles: [], message: ' ' }] },
      { conditions: [], actions: ['n'] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.map((e) => e.id)).toEqual(['rule-act-n-message', 'rule-act-n-userIds']);
  });

  it('một trường chỉ một dòng lỗi (webhook rỗng không đẻ hai lỗi cùng id)', () => {
    const r = validateRulePayload({ ...valid, actions: [{ type: 'webhook', url: '' }] }, ids);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.id)).toEqual(['rule-act-a1-url']);
  });

  it('nhãn nêu số thứ tự và tên ô; thông báo lỗi mặc định tiếng Anh của zod được thay bằng tiếng Việt', () => {
    const r = validateRulePayload({ ...valid, actions: [{ type: 'webhook', url: 'abc' }] }, ids);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const [e] = r.errors;
    expect(e!.label).toBe('Hành động 1 · Địa chỉ webhook');
    expect(e!.message).toMatch(/http/);
    expect(e!.message).not.toMatch(/^[\x00-\x7F]*$/); // có dấu tiếng Việt
  });

  it('điều kiện JQL rỗng → lỗi ở ô JQL của đúng điều kiện, nhãn "Điều kiện 2"', () => {
    const r = validateRulePayload({ ...valid, conditions: [{ jql: '   ' }, { jql: '' }] }, ids);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => [e.id, e.label])).toEqual([
      ['rule-cond-c1-jql', 'Điều kiện 1 · JQL'],
      ['rule-cond-c2-jql', 'Điều kiện 2 · JQL'],
    ]);
    expect(r.errors[0]!.message).toBe('JQL không được để trống');
  });

  it('xoá hàng giữa chừng: lỗi bám theo id hàng chứ không theo chỉ số cũ', () => {
    const r = validateRulePayload(
      { ...valid, actions: [{ type: 'transition', toStatusId: '' }] },
      { conditions: [], actions: ['only'] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.id).toBe('rule-act-only-toStatusId');
  });

  it('thiếu hành động → lỗi ở khối hành động; quá 20 điều kiện → khối điều kiện', () => {
    const none = validateRulePayload({ ...valid, actions: [] }, { conditions: [], actions: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0]).toMatchObject({ id: 'rule-actions', label: 'Hành động' });
    const many = validateRulePayload(
      { ...valid, conditions: Array.from({ length: 21 }, () => ({ jql: 'a = b' })) },
      { conditions: Array.from({ length: 21 }, (_, i) => `x${i}`), actions: ['a1'] },
    );
    expect(many.ok).toBe(false);
    if (!many.ok) {
      expect(many.errors[0]).toMatchObject({ id: 'rule-conditions' });
      expect(many.errors[0]!.message).toBe('Tối đa 20 điều kiện');
    }
  });
});

describe('ruleIssueToFieldError (đường dẫn zod → id trường)', () => {
  const issue = (path: (string | number)[], message = 'Hãy chọn', code = 'custom') => ({
    path,
    message,
    code,
  });
  it('các khoá hành động → id theo id hàng', () => {
    expect(ruleIssueToFieldError(issue(['actions', 1, 'userId']), ids)?.id).toBe(
      'rule-act-a2-userId',
    );
    expect(ruleIssueToFieldError(issue(['actions', 2, 'userIds']), ids)?.id).toBe(
      'rule-act-a3-userIds',
    );
  });
  it('chỉ số lệch ngoài danh sách id (không xảy ra) → rơi về khối hành động, không ném lỗi', () => {
    expect(ruleIssueToFieldError(issue(['actions', 9, 'url']), ids)?.id).toBe('rule-actions');
  });
  it('invalid_union của điều kiện → ô điều kiện đó; sự kiện/cấu hình → ô sự kiện', () => {
    expect(
      ruleIssueToFieldError(issue(['conditions', 0], 'Invalid input', 'invalid_union'), ids),
    ).toMatchObject({
      id: 'rule-cond-c1',
      label: 'Điều kiện 1',
    });
    expect(ruleIssueToFieldError(issue(['triggerConfig', 'cron']), ids)?.id).toBe('rule-trigger');
    expect(ruleIssueToFieldError(issue(['trigger']), ids)?.id).toBe('rule-trigger');
  });
  it('khoá lạ không có trong bảng → vẫn có lỗi dùng được (id khối hành động, câu chung)', () => {
    const e = ruleIssueToFieldError(issue(['actions', 0, 'zzz'], 'Required', 'invalid_type'), ids);
    expect(e?.id).toBe('rule-act-a1-zzz');
    expect(e?.message).toBe('Giá trị chưa hợp lệ');
  });
});
