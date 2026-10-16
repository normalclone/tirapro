import { describe, expect, it } from 'vitest';
import { JQL_FIELDS } from './jql';
import { JQL_FIELD_HINTS, suggestJql, type JqlCatalog } from './jql-suggest';

const cat: JqlCatalog = {
  statuses: ['To Do', 'In Progress', 'Done'],
  types: ['Bug', 'Story'],
  priorities: ['High', 'Low'],
  sprints: ['Sprint 1'],
  labels: ['frontend'],
  resolutions: ['Done'],
  projects: ['DEMO'],
};
const labels = (text: string, caret = text.length) =>
  suggestJql(text, caret, cat).items.map((i) => i.label);

describe('suggestJql', () => {
  it('đầu câu → tên trường, lọc theo tiền tố', () => {
    expect(labels('')).toContain('status');
    expect(labels('sta')).toEqual(expect.arrayContaining(['status', 'statusCategory']));
    expect(labels('sta')).not.toContain('assignee');
  });
  it('sau tên trường → toán tử', () => {
    expect(labels('status ')).toEqual(expect.arrayContaining(['=', '!=', 'IN']));
    expect(labels('summary ')).toEqual(expect.arrayContaining(['~']));
  });
  it('sau toán tử → giá trị thật, bọc nháy nếu có khoảng trắng', () => {
    const r = suggestJql('status = ', 9, cat);
    expect(r.items.map((i) => i.insert)).toContain('"In Progress"');
    expect(r.items.map((i) => i.insert)).toContain('Done');
  });
  it('đang gõ giữa giá trị → thay đúng đoạn đang gõ', () => {
    const r = suggestJql('status = In', 11, cat);
    expect(r.items.map((i) => i.label)).toContain('In Progress');
    expect([r.from, r.to]).toEqual([9, 11]);
  });
  it('assignee → me / currentUser()', () => {
    expect(labels('assignee = ')).toEqual(expect.arrayContaining(['me', 'currentUser()']));
  });
  it('sau giá trị đầy đủ → AND/OR/ORDER BY', () => {
    expect(labels('status = Done ')).toEqual(expect.arrayContaining(['AND', 'OR', 'ORDER BY']));
  });
  it('sau AND → lại tên trường; ORDER BY → trường rồi ASC/DESC', () => {
    expect(labels('status = Done AND ')).toContain('priority');
    expect(labels('status = Done ORDER BY ')).toContain('created');
    expect(labels('ORDER BY created ')).toEqual(expect.arrayContaining(['ASC', 'DESC']));
  });
  it('chuỗi đã đóng nháy → gợi ý tiếp; đang trong nháy của trường chữ tự do → không gợi ý', () => {
    expect(labels('summary ~ "abc" ')).toEqual(expect.arrayContaining(['AND']));
    expect(suggestJql('summary ~ "abc', 14, cat).items).toEqual([]);
  });
  it('giá trị cho IN (a, ', () => {
    expect(labels('status IN (Done, ')).toContain('To Do');
  });

  it('trong nháy chưa đóng của trường có danh mục → vẫn gợi ý theo tiền tố và giữ nháy', () => {
    const r = suggestJql('status = "In', 12, cat);
    expect(r.items.map((i) => i.insert)).toEqual(['"In Progress"']);
    expect([r.from, r.to]).toEqual([9, 12]);
  });
  it('NOT IN / IS NOT / IS → toán tử & EMPTY', () => {
    expect(labels('status NOT ')).toEqual(['IN']);
    expect(labels('status IS ')).toEqual(expect.arrayContaining(['EMPTY', 'NOT']));
    expect(labels('status IS NOT ')).toEqual(['EMPTY']);
    expect(labels('status IN ')).toEqual(['(']);
    expect(labels('status IN (')).toContain('Done');
  });
  it('toán tử theo kiểu trường: ngày/số không có IN/IS', () => {
    expect(labels('created ')).toEqual(['=', '!=', '>', '>=', '<', '<=']);
    expect(labels('storyPoints ')).not.toContain('IN');
  });
  it('trường ngày → hàm mốc và ngày tương đối; statusCategory → enum', () => {
    expect(labels('created > ')).toEqual(
      expect.arrayContaining(['startOfWeek()', 'now()', '-7d', '-30d']),
    );
    expect(labels('statusCategory = ')).toEqual(['TODO', 'IN_PROGRESS', 'DONE']);
  });
  it('IS → EMPTY, không tràn giá trị', () => {
    expect(labels('status IS NOT E')).toEqual(['EMPTY']);
  });
  it('sau NOT / "(" → trường; giữa câu có ngoặc → đóng ngoặc', () => {
    expect(labels('NOT ')).toContain('status');
    expect(labels('(status = Done ')).toContain(')');
    expect(labels('status = Done ')).not.toContain(')');
  });
  it('không dấu / không phân biệt hoa thường', () => {
    expect(labels('STA')).toContain('status');
    expect(suggestJql('sprint = spr', 12, cat).items.map((i) => i.label)).toEqual(['Sprint 1']);
  });
  it('tối đa 12 mục', () => {
    expect(suggestJql('', 0, cat).items.length).toBeLessThanOrEqual(12);
  });
  it('con trỏ giữa từ → thay cả từ', () => {
    const r = suggestJql('sta = Done', 2, cat);
    expect(r.items.map((i) => i.label)).toContain('status');
    expect([r.from, r.to]).toEqual([0, 3]);
  });
  it('chuỗi đóng nháy / ")" dính con trỏ → không gợi ý (sẽ dính liền)', () => {
    expect(suggestJql('summary ~ "abc"', 15, cat).items).toEqual([]);
    expect(suggestJql('status IN (Done)', 16, cat).items).toEqual([]);
  });
  it('mọi trường JQL đều có mô tả và có thể gợi ý toán tử', () => {
    for (const f of Object.keys(JQL_FIELDS)) {
      expect(JQL_FIELD_HINTS[f as keyof typeof JQL_FIELD_HINTS]).toBeTruthy();
      expect(labels(`${f} `).length).toBeGreaterThan(0);
    }
  });
  it('thành phần / phiên bản (B17) gợi ý giá trị từ danh mục', () => {
    const c2: JqlCatalog = { ...cat, components: ['API'], versions: ['v1.0'] };
    const l = (t: string) => suggestJql(t, t.length, c2).items.map((i) => i.label);
    expect(l('component = ')).toContain('API');
    expect(l('fixVersion = ')).toContain('v1.0');
    expect(l('affectedVersion IN (')).toContain('v1.0');
  });
  it('con trỏ giữa chuỗi nháy đã đóng → thay cả nháy đóng (không ra "" thừa)', () => {
    const r = suggestJql('status = "In"', 12, cat);
    expect(r.items.map((i) => i.insert)).toContain('"In Progress"');
    expect([r.from, r.to]).toEqual([9, 13]);
    // nháy sau đó thuộc chuỗi khác (liền chữ) → không nuốt
    const r2 = suggestJql('status = "In AND summary ~ "x"', 12, cat);
    expect(r2.to).toBe(12);
  });
});
