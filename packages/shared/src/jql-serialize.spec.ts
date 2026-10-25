import { describe, expect, it } from 'vitest';
import { parseJql } from './jql-parser';
import type { JqlNode } from './jql';
import { andAll, flattenAnd, serializeJqlNode, serializeJqlQuery } from './jql-serialize';

const where = (jql: string): JqlNode => {
  const w = parseJql(jql).where;
  if (!w) throw new Error('JQL rỗng');
  return w;
};

/** parse(serialize(parse(x))) phải bằng parse(x) — cấu trúc cây, không chỉ chuỗi. */
const roundTrips = (jql: string): void => {
  const first = parseJql(jql);
  const text = serializeJqlQuery(first);
  expect(parseJql(text)).toEqual(first);
};

describe('serializeJqlNode — round-trip', () => {
  const samples: Record<string, string> = {
    'so sánh đơn': 'status = "In Progress"',
    'mọi toán tử': 'storyPoints >= 3 AND storyPoints < 8 AND summary ~ "lỗi" AND summary !~ "x"',
    '!=': 'priority != High',
    IN: 'status IN ("To Do", "In Progress", Done)',
    'NOT IN': 'labels NOT IN (a, b)',
    'IN rỗng': 'labels IN ()',
    'IS EMPTY': 'assignee IS EMPTY',
    'IS NOT EMPTY': 'assignee IS NOT EMPTY',
    'chuỗi có nháy kép': 'summary ~ "nói \\"xin chào\\" nhé"',
    'chuỗi có nháy đơn': `summary ~ "it's fine"`,
    'chuỗi có backslash': 'summary ~ "a\\\\b"',
    'chuỗi có dấu tiếng Việt': 'summary ~ "Đăng nhập thất bại — Ớt ơi"',
    'chuỗi giống từ khoá': 'summary ~ "AND" AND labels IN ("true", "EMPTY", "now", "7d", "12")',
    'chuỗi rỗng': 'summary ~ ""',
    'currentUser()': 'assignee = currentUser()',
    'currentUser trong IN': 'assignee IN (currentUser(), "u2")',
    'alias me': 'reporter = currentUser',
    'hàm ngày': 'created >= startOfWeek() AND due <= endOfMonth()',
    'ngày tương đối': 'created >= -7d AND updated <= 2w AND due > 1m',
    'số âm và thập phân': 'storyPoints > -1.5',
    bool: 'summary = true',
    NOT: 'NOT (status = Done)',
    'NOT lồng': 'NOT (NOT (status = Done))',
    'NOT nhóm OR': 'project = A AND NOT (status = Done OR status = Closed)',
    'AND/OR lồng': 'project = A AND (status = Done OR (priority = High AND labels IN (x, y)))',
    'OR gốc': 'status = Done OR priority = High',
    'AND phải lồng cùng toán tử': 'project = A AND (status = Done AND priority = High)',
    'OR phải lồng cùng toán tử': 'project = A OR (status = Done OR priority = High)',
    'ORDER BY': 'status = Done ORDER BY priority DESC, created ASC',
    'chỉ ORDER BY': 'ORDER BY created DESC',
    rỗng: '',
  };
  for (const [name, jql] of Object.entries(samples)) {
    it(name, () => roundTrips(jql));
  }
  it('AND trong OR không ngoặc giữ cấu trúc', () => {
    roundTrips('status = A OR priority = High AND labels = x');
  });
  it('chuỗi bareword và có nháy cho cùng AST → cùng đầu ra', () => {
    expect(serializeJqlNode(where('status = Done'))).toBe(
      serializeJqlNode(where('status = "Done"')),
    );
  });
  it('số rất lớn không in dạng khoa học', () => {
    const n = where('storyPoints > 123456789012345678901234');
    expect(serializeJqlNode(n)).not.toMatch(/e/i);
    expect(parseJql(serializeJqlNode(n)).where).toEqual(n);
  });
});

describe('serializeJqlNode — đầu ra', () => {
  it('so sánh', () => {
    expect(serializeJqlNode(where('Status=done'))).toBe('status = "done"');
  });
  it('currentUser()', () => {
    expect(serializeJqlNode(where('assignee = currentUser()'))).toBe('assignee = currentUser()');
  });
  it('IN', () => {
    expect(serializeJqlNode(where('status in (a,"b c")'))).toBe('status IN ("a", "b c")');
  });
  it('nháy và backslash được escape', () => {
    expect(serializeJqlNode(where('summary ~ "a\\"b"'))).toBe('summary ~ "a\\"b"');
  });
  it('OR dưới AND được bọc ngoặc, AND dưới OR thì không', () => {
    expect(serializeJqlNode(where('status = A AND (priority = High OR priority = Low)'))).toBe(
      'status = "A" AND (priority = "High" OR priority = "Low")',
    );
    expect(serializeJqlNode(where('status = A OR priority = B AND labels = c'))).toBe(
      'status = "A" OR priority = "B" AND labels = "c"',
    );
  });
  it('NOT luôn có ngoặc', () => {
    expect(serializeJqlNode(where('NOT (status = Done)'))).toBe('NOT (status = "Done")');
  });
  it('serializeJqlQuery giữ ORDER BY; rỗng → chuỗi rỗng', () => {
    expect(serializeJqlQuery(parseJql('status = A ORDER BY created DESC'))).toBe(
      'status = "A" ORDER BY created DESC',
    );
    expect(serializeJqlQuery(parseJql('ORDER BY created'))).toBe('ORDER BY created ASC');
    expect(serializeJqlQuery(parseJql(''))).toBe('');
  });
});

describe('flattenAnd', () => {
  const texts = (jql: string) => flattenAnd(parseJql(jql).where).map(serializeJqlNode);

  it('rỗng → []', () => expect(flattenAnd(null)).toEqual([]));
  it('một so sánh → 1 mệnh đề', () => expect(texts('status = A')).toEqual(['status = "A"']));
  it('chuỗi AND → từng vế theo thứ tự', () => {
    expect(texts('status = A AND priority = B AND labels IN (x)')).toEqual([
      'status = "A"',
      'priority = "B"',
      'labels IN ("x")',
    ]);
  });
  it('nhóm OR lồng là MỘT mệnh đề', () => {
    expect(texts('project = P AND (status = A OR status = B) AND labels = x')).toEqual([
      'project = "P"',
      'status = "A" OR status = "B"',
      'labels = "x"',
    ]);
  });
  it('NOT là MỘT mệnh đề', () => {
    expect(texts('project = P AND NOT (status = A AND priority = B)')).toEqual([
      'project = "P"',
      'NOT (status = "A" AND priority = "B")',
    ]);
  });
  it('OR ở gốc là MỘT mệnh đề', () => {
    expect(flattenAnd(where('status = A OR priority = B'))).toHaveLength(1);
  });
  it('nhóm AND có ngoặc được làm phẳng (cùng nghĩa)', () => {
    expect(texts('project = P AND (status = A AND priority = B)')).toHaveLength(3);
  });
});

describe('andAll', () => {
  it('rỗng → null; một → chính nó', () => {
    expect(andAll([])).toBeNull();
    const n = where('status = A');
    expect(andAll([n])).toBe(n);
  });
  it('nối AND trái-kết-hợp: flatten(andAll(x)) = x', () => {
    const parts = flattenAnd(where('status = A AND priority = B AND labels = c'));
    expect(flattenAnd(andAll(parts))).toEqual(parts);
  });
  it('bỏ một mệnh đề rồi serialize ra JQL hợp lệ, parse lại bằng đúng cây đó', () => {
    const parts = flattenAnd(where('project = P AND (status = A OR status = B) AND labels = c'));
    const without = andAll([parts[0]!, parts[2]!]);
    expect(parseJql(serializeJqlNode(without!)).where).toEqual(without);
  });
});
