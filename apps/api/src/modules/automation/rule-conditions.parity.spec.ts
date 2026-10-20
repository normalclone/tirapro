import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { RULE_CONDITION_FIELDS, RULE_CONDITION_OPS } from '@tirapro/shared';
import { selects, type Row } from '../../common/testing/where-matcher';
import { evalFieldCondition, fieldConditionToWhere, type FieldCondition } from './rule-conditions';

/**
 * SPEC ĐỐI CHỨNG: với mọi trường × phép so sánh × (rất nhiều) giá trị × (rất nhiều) issue, `evalFieldCondition` (engine,
 * chấm trong bộ nhớ) và `fieldConditionToWhere` (xem trước, chạy ở DB) phải CHỌN CÙNG tập issue. Repo không có DB test
 * nên `where` được đánh giá bằng `common/testing/where-matcher` (logic ba giá trị như SQL, LIKE thật). Mọi (trường, phép)
 * mà `where` không diễn đạt chính xác được trả `null` và bị loại khỏi xem trước — không bao giờ xấp xỉ.
 */

type Field = (typeof RULE_CONDITION_FIELDS)[number];
interface Fx {
  statusId: string;
  priorityId: string | null;
  assigneeId: string | null;
  reporterId: string | null;
  typeId: string;
  sprintId: string | null;
  resolutionId: string | null;
  storyPoints: number | null;
  summary: string;
  labelIds: string[];
  dueDate: Date | null;
}
const BASE: Fx = {
  statusId: 's1',
  priorityId: 'p1',
  assigneeId: 'u1',
  reporterId: 'u2',
  typeId: 't1',
  sprintId: 'sp1',
  resolutionId: 'r1',
  storyPoints: 3,
  summary: 'Đăng nhập lỗi',
  labelIds: ['l1'],
  dueDate: new Date('2026-10-20T10:00:00.000Z'),
};

/** Issue theo hình dạng engine thấy (IssueDto) và hàng theo hình dạng Prisma thấy — từ CÙNG một fixture. */
const dto = (f: Fx): IssueDto =>
  ({
    status: { id: f.statusId },
    priority: f.priorityId ? { id: f.priorityId } : null,
    assigneeId: f.assigneeId,
    reporterId: f.reporterId,
    type: { id: f.typeId },
    sprintId: f.sprintId,
    resolution: f.resolutionId ? { id: f.resolutionId } : null,
    storyPoints: f.storyPoints,
    summary: f.summary,
    labels: f.labelIds.map((id) => ({ id })),
    dueDate: f.dueDate ? f.dueDate.toISOString() : null,
  }) as unknown as IssueDto;
const row = (f: Fx): Row => ({
  ...f,
  labels: f.labelIds.map((labelId) => ({ labelId })),
});

const POOL: Record<Field, unknown[]> = {
  statusId: ['s1', 's2', 'S1', '5'],
  priorityId: [null, 'p1', 'p2'],
  assigneeId: [null, 'u1', 'u2', 'U1'],
  reporterId: [null, 'u1', 'u2'],
  typeId: ['t1', 't2'],
  sprintId: [null, 'sp1', '5', '05'],
  resolutionId: [null, 'r1'],
  storyPoints: [null, 0, 1, 5, 5.5, 13, -2],
  summary: ['Đăng nhập lỗi', 'LOGIN failed', '50% done', 'a_b', 'c\\d', '', 'ABC', 'abc', 'x'],
  labelIds: [[], ['l1'], ['l1', 'l2'], ['l3'], ['5']],
  dueDate: [
    null,
    new Date('2026-10-20T00:00:00.000Z'),
    new Date('2026-10-20T23:59:59.999Z'),
    new Date('2026-10-21T00:00:00.000Z'),
    new Date('2026-10-19T23:59:59.999Z'),
  ],
};

const GENERIC: unknown[] = [
  undefined,
  null,
  '',
  'x',
  0,
  5,
  '5',
  '5.0',
  '05',
  5.5,
  '5.5',
  true,
  false,
  [],
  [null],
  [5, '5'],
  { a: 1 },
  [{ a: 1 }],
  ['s1', 'p1', 'u1', 't1', 'sp1', 'r1', 'l1', '5', 5, null],
];
const SPECIFIC: Record<Field, unknown[]> = {
  statusId: ['s1', 's2', 'S1', ['s1', 's2'], ['S1']],
  priorityId: ['p1', 'p2', ['p1', null], ['p2']],
  assigneeId: ['u1', 'U1', 'u', ['u1', 'u2'], ['u2', null]],
  reporterId: ['u1', 'u2', ['u2'], ['u1', null]],
  typeId: ['t1', 't2', ['t1', 't2']],
  sprintId: ['sp1', 'SP', 5, '5', '05', ['sp1', 5], ['sp1', null]],
  resolutionId: ['r1', ['r1', null]],
  storyPoints: [-2, 13, '13', '-2', 1, '1', 0, '0', '0.0', [1, '5'], [5.5, null], ['abc']],
  summary: [
    'Đăng',
    'ĐĂNG NHẬP',
    'đăng nhập lỗi',
    'LOGIN',
    'login',
    '%',
    '_',
    '\\',
    '50%',
    'a_b',
    'a%b',
    'c\\d',
    'ABC',
    'abc',
    ['abc'],
    'Đăng nhập lỗi',
  ],
  labelIds: [
    'l1',
    'l2',
    'l3',
    'L1',
    '5',
    5,
    ['l1'],
    ['l2', 'l3'],
    ['l1', 'l3'],
    ['5'],
    [5],
    ['l1', null],
  ],
  dueDate: [
    '2026-10-20',
    '2026-10-21',
    '2026-10-19',
    '2026-10-20T00:00:00.000Z',
    '2026-02-30',
    '2026-1-5',
    20261020,
    ['2026-10-20', '2026-10-21'],
    ['2026-10-20', null],
    ['2026-02-30'],
    '2026-10',
    '10-20',
  ],
};

const fixturesFor = (field: Field): Fx[] => POOL[field].map((v) => ({ ...BASE, [field]: v }));

const label = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v === undefined ? 'undefined' : JSON.stringify(v);

const SUPPORTED_NULL = new Set(['dueDate:contains']); // không diễn đạt được trong Prisma → loại khỏi xem trước

describe('fieldConditionToWhere ↔ evalFieldCondition — đối chứng', () => {
  for (const field of RULE_CONDITION_FIELDS) {
    for (const op of RULE_CONDITION_OPS) {
      it(`${field} × ${op}: cùng tập issue được chọn trên mọi giá trị`, () => {
        const wanteds = [...GENERIC, ...SPECIFIC[field]];
        const fixtures = fixturesFor(field);
        const mismatches: string[] = [];
        let compared = 0;
        for (const wanted of wanteds) {
          const c = {
            field,
            op,
            ...(wanted === undefined ? {} : { value: wanted }),
          };
          const where = fieldConditionToWhere(c);
          if (where === null) {
            expect(SUPPORTED_NULL.has(`${field}:${op}`), `${field}:${op} không được null`).toBe(
              true,
            );
            continue;
          }
          for (const fx of fixtures) {
            compared++;
            const expected = evalFieldCondition(dto(fx), c);
            const actual = selects(row(fx), where);
            if (expected !== actual) {
              mismatches.push(
                `${field} ${op} ${label(wanted)} | issue ${label(fx[field])}: engine=${expected} where=${actual}`,
              );
            }
          }
        }
        expect(mismatches).toEqual([]);
        if (!SUPPORTED_NULL.has(`${field}:${op}`)) expect(compared).toBeGreaterThan(30);
      });
    }
  }

  it('chỉ có (dueDate, contains) là không xem trước được; mọi cặp khác đều có where', () => {
    const nulls: string[] = [];
    for (const field of RULE_CONDITION_FIELDS)
      for (const op of RULE_CONDITION_OPS)
        if (fieldConditionToWhere({ field, op, value: 'x' }) === null) nulls.push(`${field}:${op}`);
    expect(nulls).toEqual(['dueDate:contains']);
  });
});

describe('đối chứng — các ca được nêu tên', () => {
  const pick = (field: Field, c: FieldCondition, ...fx: Partial<Fx>[]) => {
    const where = fieldConditionToWhere(c);
    expect(where).not.toBeNull();
    return fx.map((p) => {
      const f = { ...BASE, ...p };
      const e = evalFieldCondition(dto(f), c);
      const a = selects(row(f), where!);
      expect(a, `${field} ${c.op} ${label(c.value)} trên ${label(p)}`).toBe(e);
      return a;
    });
  };

  it('neq / nin trên mảng nhãn: "không có nhãn nào trong danh sách", kể cả issue KHÔNG có nhãn', () => {
    const neq = { field: 'labelIds', op: 'neq', value: 'l1' } as FieldCondition;
    expect(
      pick(
        'labelIds',
        neq,
        { labelIds: [] },
        { labelIds: ['l1'] },
        { labelIds: ['l1', 'l2'] },
        { labelIds: ['l2'] },
      ),
    ).toEqual([true, false, false, true]);
    const nin = { field: 'labelIds', op: 'nin', value: ['l1', 'l2'] } as FieldCondition;
    expect(
      pick('labelIds', nin, { labelIds: [] }, { labelIds: ['l3'] }, { labelIds: ['l2', 'l3'] }),
    ).toEqual([true, true, false]);
  });

  it('neq / nin trên cột có thể NULL: issue chưa gán vẫn thoả "khác" (SQL NOT(NULL) không được làm rơi nó)', () => {
    const neq = { field: 'assigneeId', op: 'neq', value: 'u1' } as FieldCondition;
    expect(
      pick('assigneeId', neq, { assigneeId: null }, { assigneeId: 'u1' }, { assigneeId: 'u2' }),
    ).toEqual([true, false, true]);
    const nin = { field: 'sprintId', op: 'nin', value: ['sp1', 'sp2'] } as FieldCondition;
    expect(
      pick('sprintId', nin, { sprintId: null }, { sprintId: 'sp1' }, { sprintId: 'sp9' }),
    ).toEqual([true, false, true]);
  });

  it('số và chuỗi: same("5", 5) — "5" và 5 như nhau; "5.0" và "05" thì không', () => {
    const sp = (value: unknown) => ({ field: 'storyPoints', op: 'eq', value }) as FieldCondition;
    expect(
      pick('storyPoints', sp('5'), { storyPoints: 5 }, { storyPoints: 6 }, { storyPoints: null }),
    ).toEqual([true, false, false]);
    expect(pick('storyPoints', sp(5), { storyPoints: 5 }, { storyPoints: 5.5 })).toEqual([
      true,
      false,
    ]);
    expect(pick('storyPoints', sp('5.0'), { storyPoints: 5 })).toEqual([false]);
    expect(pick('storyPoints', sp('05'), { storyPoints: 5 })).toEqual([false]);
    const idCol = { field: 'sprintId', op: 'eq', value: 5 } as FieldCondition;
    expect(pick('sprintId', idCol, { sprintId: '5' }, { sprintId: 'sp1' })).toEqual([true, false]);
  });

  it('contains không phân biệt hoa/thường (có dấu tiếng Việt) và coi % _ \\ là chữ thường', () => {
    const c = (value: string) => ({ field: 'summary', op: 'contains', value }) as FieldCondition;
    expect(pick('summary', c('ĐĂNG'), { summary: 'đăng nhập' }, { summary: 'Dang nhap' })).toEqual([
      true,
      false,
    ]);
    expect(pick('summary', c('%'), { summary: '50% done' }, { summary: 'hết' })).toEqual([
      true,
      false,
    ]);
    expect(pick('summary', c('_'), { summary: 'a_b' }, { summary: 'ab' })).toEqual([true, false]);
    expect(pick('summary', c('\\'), { summary: 'c\\d' }, { summary: 'cd' })).toEqual([true, false]);
    expect(pick('summary', c(''), { summary: 'bất kỳ' })).toEqual([true]);
  });

  it('empty / notEmpty: NULL, chuỗi rỗng và mảng rỗng đều là "trống"', () => {
    const e = (field: Field, op: 'empty' | 'notEmpty') => ({ field, op }) as FieldCondition;
    expect(
      pick('labelIds', e('labelIds', 'empty'), { labelIds: [] }, { labelIds: ['l1'] }),
    ).toEqual([true, false]);
    expect(
      pick('labelIds', e('labelIds', 'notEmpty'), { labelIds: [] }, { labelIds: ['l1'] }),
    ).toEqual([false, true]);
    expect(pick('summary', e('summary', 'empty'), { summary: '' }, { summary: 'a' })).toEqual([
      true,
      false,
    ]);
    expect(
      pick('assigneeId', e('assigneeId', 'empty'), { assigneeId: null }, { assigneeId: 'u1' }),
    ).toEqual([true, false]);
    expect(
      pick('storyPoints', e('storyPoints', 'empty'), { storyPoints: null }, { storyPoints: 0 }),
    ).toEqual([true, false]);
    expect(
      pick('dueDate', e('dueDate', 'notEmpty'), { dueDate: null }, { dueDate: new Date() }),
    ).toEqual([false, true]);
  });

  it('dueDate so theo NGÀY UTC (cắt 10 ký tự ISO như engine), không theo giờ', () => {
    const d = (value: unknown) => ({ field: 'dueDate', op: 'eq', value }) as FieldCondition;
    expect(
      pick(
        'dueDate',
        d('2026-10-20'),
        { dueDate: new Date('2026-10-20T00:00:00.000Z') },
        { dueDate: new Date('2026-10-20T23:59:59.999Z') },
        { dueDate: new Date('2026-10-21T00:00:00.000Z') },
        { dueDate: new Date('2026-10-19T23:59:59.999Z') },
      ),
    ).toEqual([true, true, false, false]);
    expect(
      pick('dueDate', d('2026-02-30'), { dueDate: new Date('2026-03-02T00:00:00.000Z') }),
    ).toEqual([false]);
  });
});

describe('đối chứng — bài học từ Postgres thật (RC20)', () => {
  /** Prisma bỏ qua `OR: []` khi nó nằm TRONG `AND: [...]` (trả MỌI hàng thay vì không hàng nào) — đo trên Postgres thật. */
  const hasEmptyOr = (node: unknown): boolean =>
    Array.isArray(node)
      ? node.some(hasEmptyOr)
      : node !== null && typeof node === 'object'
        ? Object.entries(node).some(
            ([k, v]) => (k === 'OR' && Array.isArray(v) && v.length === 0) || hasEmptyOr(v),
          )
        : false;

  it('KHÔNG BAO GIỜ sinh `OR: []` (dùng { id: { in: [] } } cho "không khớp gì")', () => {
    const offenders: string[] = [];
    const values: unknown[] = [
      undefined,
      null,
      '',
      'x',
      5,
      '5.0',
      [],
      [null],
      ['x'],
      '2026-02-30',
      {},
      true,
    ];
    for (const field of RULE_CONDITION_FIELDS)
      for (const op of RULE_CONDITION_OPS)
        for (const value of values) {
          const c: FieldCondition = { field, op, ...(value === undefined ? {} : { value }) };
          if (hasEmptyOr(fieldConditionToWhere(c))) offenders.push(JSON.stringify(c));
        }
    expect(offenders).toEqual([]);
  });

  it('"không khớp gì" thật sự không chọn hàng nào (cả khi nằm trong AND)', () => {
    const never = fieldConditionToWhere({ field: 'statusId', op: 'in', value: [] })!;
    expect(selects(row(BASE), { AND: [never] })).toBe(false);
    expect(selects(row(BASE), never)).toBe(false);
  });

  it('contains với chữ mà JS và Postgres gấp khác nhau (İ, sigma, ǅ, Hy Lạp, Kirin…) → null, KHÔNG đếm xấp xỉ', () => {
    for (const v of ['İ', 'ΟΔΟΣ', 'ǅ', 'привет', 'ẞ'])
      expect(fieldConditionToWhere({ field: 'summary', op: 'contains', value: v }), v).toBeNull();
  });

  it('contains với chữ Việt/ASCII/emoji vẫn có where', () => {
    for (const v of ['lỗi', 'ĐƯỜNG', 'Ke\u0302\u0301', '100%', '😀', ''])
      expect(
        fieldConditionToWhere({ field: 'summary', op: 'contains', value: v }),
        v,
      ).not.toBeNull();
  });

  it('engine gấp chữ theo từng ký tự: İSTANBUL chứa "istanbul"; ΟΔΟΣ chứa "οδοσ" (không theo ngữ cảnh sigma cuối)', () => {
    const c = (value: string) => ({ field: 'summary', op: 'contains', value }) as FieldCondition;
    expect(evalFieldCondition(dto({ ...BASE, summary: 'İSTANBUL' }), c('istanbul'))).toBe(true);
    expect(evalFieldCondition(dto({ ...BASE, summary: 'ΟΔΟΣ' }), c('οδοσ'))).toBe(true);
    expect(evalFieldCondition(dto({ ...BASE, summary: 'Đăng nhập lỗi' }), c('LỖI'))).toBe(true);
  });
});
