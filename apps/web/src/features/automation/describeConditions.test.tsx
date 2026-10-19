import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuleCondition } from '@tirapro/shared';
import {
  CONDITION_JOINER,
  OR_HINT,
  conditionClauses,
  conditionSentenceText,
  describeCondition,
} from './describeConditions';
import { ConditionSentence } from './ConditionSentence';

const names: Record<string, string> = { p1: 'High', p2: 'Highest', t1: 'Bug', u1: 'Lan' };
const nameOf = (_field: string, id: string) => names[id];

describe('describeCondition', () => {
  it('so sánh một giá trị tra tên theo id: "Loại công việc là Bug"', () => {
    expect(describeCondition({ field: 'typeId', op: 'eq', value: 't1' }, nameOf)).toBe(
      'Loại công việc là Bug',
    );
    expect(describeCondition({ field: 'assigneeId', op: 'neq', value: 'u1' }, nameOf)).toBe(
      'Người làm không phải Lan',
    );
  });
  it('giá trị là danh sách: nối bằng dấu phẩy, tra tên từng phần tử', () => {
    expect(describeCondition({ field: 'priorityId', op: 'in', value: ['p1', 'p2'] }, nameOf)).toBe(
      'Mức ưu tiên là một trong High, Highest',
    );
    expect(describeCondition({ field: 'priorityId', op: 'nin', value: ['p1'] }, nameOf)).toBe(
      'Mức ưu tiên không nằm trong High',
    );
  });
  it('danh sách rỗng / thiếu giá trị → dấu … để biết còn thiếu', () => {
    expect(describeCondition({ field: 'priorityId', op: 'in', value: [] }, nameOf)).toBe(
      'Mức ưu tiên là một trong …',
    );
    expect(describeCondition({ field: 'priorityId', op: 'eq', value: '' }, nameOf)).toBe(
      'Mức ưu tiên là …',
    );
    expect(describeCondition({ field: 'storyPoints', op: 'eq', value: NaN }, nameOf)).toBe(
      'Điểm ước lượng là …',
    );
    expect(describeCondition({ field: 'priorityId', op: 'eq' }, nameOf)).toBe('Mức ưu tiên là …');
  });
  it('phép không cần giá trị; tiêu đề "chứa" đặt trong ngoặc kép', () => {
    expect(describeCondition({ field: 'assigneeId', op: 'empty' }, nameOf)).toBe(
      'Người làm đang trống',
    );
    expect(describeCondition({ field: 'dueDate', op: 'notEmpty' }, nameOf)).toBe(
      'Hạn đã có giá trị',
    );
    expect(
      describeCondition({ field: 'summary', op: 'contains', value: 'lỗi đăng nhập' }, nameOf),
    ).toBe('Tiêu đề chứa "lỗi đăng nhập"');
  });
  it('số và ngày: số in nguyên; ngày YYYY-MM-DD đổi sang dd/MM/yyyy', () => {
    expect(describeCondition({ field: 'storyPoints', op: 'eq', value: 5 }, nameOf)).toBe(
      'Điểm ước lượng là 5',
    );
    expect(describeCondition({ field: 'dueDate', op: 'eq', value: '2026-10-19' }, nameOf)).toBe(
      'Hạn là 19/10/2026',
    );
  });
  it('id không tra được tên → giữ nguyên id, không vỡ', () => {
    expect(describeCondition({ field: 'typeId', op: 'eq', value: 'zzz' }, nameOf)).toBe(
      'Loại công việc là zzz',
    );
  });
  it('trường/phép lạ (ngoài danh mục) → hiện nguyên tên, không ném lỗi', () => {
    const odd = { field: 'weird', op: 'wow', value: 'x' } as unknown as RuleCondition;
    expect(describeCondition(odd, nameOf)).toBe('weird wow x');
    const objVal = { field: 'summary', op: 'eq', value: { a: 1 } } as unknown as RuleCondition;
    expect(describeCondition(objVal, nameOf)).toBe('Tiêu đề là …');
  });
  it('điều kiện JQL: nêu câu JQL; rỗng → …', () => {
    expect(describeCondition({ jql: 'priority = High OR status = Open' }, nameOf)).toBe(
      'khớp bộ lọc JQL: priority = High OR status = Open',
    );
    expect(describeCondition({ jql: '  ' }, nameOf)).toBe('khớp bộ lọc JQL: …');
  });
});

describe('câu điều kiện', () => {
  const conds: RuleCondition[] = [
    { field: 'typeId', op: 'eq', value: 't1' },
    { field: 'priorityId', op: 'in', value: ['p1', 'p2'] },
    { field: 'assigneeId', op: 'empty' },
  ];
  it('không có điều kiện → không có mệnh đề', () => {
    expect(conditionClauses([], nameOf)).toEqual([]);
    expect(conditionSentenceText([], nameOf)).toBe('');
  });
  it('một điều kiện → không có từ nối', () => {
    expect(conditionSentenceText(conds.slice(0, 1), nameOf)).toBe('Loại công việc là Bug');
  });
  it('nhiều điều kiện → luôn nối bằng "và" (engine chỉ hỗ trợ VÀ)', () => {
    expect(CONDITION_JOINER).toBe('và');
    expect(conditionSentenceText(conds, nameOf)).toBe(
      'Loại công việc là Bug và Mức ưu tiên là một trong High, Highest và Người làm đang trống',
    );
    expect(conditionSentenceText(conds, nameOf)).not.toMatch(/hoặc/i);
  });
});

describe('<ConditionSentence>', () => {
  const html = (conds: RuleCondition[]) =>
    renderToStaticMarkup(<ConditionSentence conditions={conds} nameOf={nameOf} />);
  it('từ nối "và" in đậm (<strong>), phần còn lại là chữ thường', () => {
    const h = html([
      { field: 'typeId', op: 'eq', value: 't1' },
      { field: 'priorityId', op: 'eq', value: 'p1' },
    ]);
    expect(h).toContain('<strong');
    expect(h).toMatch(/<strong[^>]*>và<\/strong>/);
    expect(h.match(/<strong/g)?.length).toBe(1);
    expect(h).toContain('Loại công việc là Bug');
    expect(h).toContain('Mức ưu tiên là High');
  });
  it('luôn kèm gợi ý dùng điều kiện JQL khi cần HOẶC', () => {
    expect(OR_HINT).toMatch(/HOẶC/);
    expect(OR_HINT).toMatch(/JQL/);
    expect(html([{ field: 'typeId', op: 'eq', value: 't1' }])).toContain(OR_HINT);
    expect(html([])).toContain(OR_HINT);
  });
  it('không có điều kiện → nói rõ quy tắc chạy ở mọi việc khớp sự kiện, không có "và"', () => {
    const h = html([]);
    expect(h).toContain('Chưa có điều kiện');
    expect(h).not.toContain('<strong');
  });
  it('chỉ là chữ đọc: không có nút/ô nhập', () => {
    const h = html([{ field: 'typeId', op: 'eq', value: 't1' }]);
    expect(h).not.toMatch(/<(button|input|select|textarea)/);
  });
});
