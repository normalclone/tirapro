import type { IssueDto } from '@tirapro/types';
import type { RuleCondition } from '@tirapro/shared';

export type FieldCondition = Extract<RuleCondition, { field: string }>;
export type JqlCondition = Extract<RuleCondition, { jql: string }>;

export const isJqlCondition = (c: RuleCondition): c is JqlCondition => 'jql' in c;

/** Giá trị trường issue theo tên điều kiện (id cho quan hệ, mảng id cho nhãn). */
export function readIssueField(issue: IssueDto, field: FieldCondition['field']): unknown {
  switch (field) {
    case 'statusId':
      return issue.status.id;
    case 'priorityId':
      return issue.priority?.id ?? null;
    case 'assigneeId':
      return issue.assigneeId;
    case 'reporterId':
      return issue.reporterId;
    case 'typeId':
      return issue.type.id;
    case 'sprintId':
      return issue.sprintId;
    case 'resolutionId':
      return issue.resolution?.id ?? null;
    case 'storyPoints':
      return issue.storyPoints;
    case 'summary':
      return issue.summary;
    case 'labelIds':
      return issue.labels.map((l) => l.id);
    case 'dueDate':
      return issue.dueDate ? issue.dueDate.slice(0, 10) : null;
  }
}

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** So sánh "giống nhau" cho số/chuỗi: "5" và 5 coi là bằng nhau (giá trị từ form thường là chuỗi). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const prim = (v: unknown): v is string | number | boolean =>
    ['string', 'number', 'boolean'].includes(typeof v);
  return prim(a) && prim(b) && String(a) === String(b);
}

const asList = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];

/** Đánh giá MỘT điều kiện trường trên issue. Mảng (nhãn): eq/contains = có chứa, in = giao nhau. */
export function evalFieldCondition(issue: IssueDto, c: FieldCondition): boolean {
  const actual = readIssueField(issue, c.field);
  const wanted = c.value;
  const arr = Array.isArray(actual);
  switch (c.op) {
    case 'empty':
      return isEmpty(actual);
    case 'notEmpty':
      return !isEmpty(actual);
    case 'eq':
      return arr
        ? asList(wanted).some((w) => (actual as unknown[]).some((x) => same(x, w)))
        : same(actual, wanted);
    case 'neq':
      return !evalFieldCondition(issue, { ...c, op: 'eq' });
    case 'in': {
      const list = asList(wanted);
      return arr
        ? (actual as unknown[]).some((x) => list.some((w) => same(x, w)))
        : list.some((w) => same(actual, w));
    }
    case 'nin':
      return !evalFieldCondition(issue, { ...c, op: 'in' });
    case 'contains': {
      if (arr) return asList(wanted).some((w) => (actual as unknown[]).some((x) => same(x, w)));
      if (typeof actual !== 'string' || typeof wanted !== 'string') return false;
      return actual.toLowerCase().includes(wanted.toLowerCase());
    }
  }
}

/** Mô tả ngắn điều kiện đầu tiên không thoả (dùng cho log SKIPPED). */
export function describeCondition(c: RuleCondition): string {
  if (isJqlCondition(c)) return `JQL: ${c.jql}`;
  const v = c.value === undefined ? '' : ` ${JSON.stringify(c.value)}`;
  return `${c.field} ${c.op}${v}`;
}
