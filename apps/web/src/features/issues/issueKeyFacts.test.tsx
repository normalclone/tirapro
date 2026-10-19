import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FactTile, IssueStatusField } from './IssueKeyFacts';
import type { NextStatus } from './nextStatuses';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');
const status = { id: 's1', name: 'In Progress', category: 'IN_PROGRESS' };
const opts: NextStatus[] = [
  { id: 's2', name: 'Done', category: 'DONE', order: 3, transitionName: null, label: 'Done' },
];

describe('FactTile', () => {
  it('nhóm có tên = nhãn nhìn thấy; vùng bấm cao tối thiểu 44px', () => {
    const h = renderToStaticMarkup(
      <FactTile label="Hạn">
        <button type="button">x</button>
      </FactTile>,
    );
    expect(h).toMatch(/role="group"[^>]*aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(h)![1];
    expect(h).toMatch(new RegExp(`id="${id}"[^>]*>Hạn<`));
    expect(h).toContain('min-h-11');
  });
});

describe('IssueStatusField', () => {
  const html = (canTransition: boolean, options: NextStatus[], pending = false) =>
    renderToStaticMarkup(
      <IssueStatusField
        status={status}
        options={options}
        canTransition={canTransition}
        pending={pending}
        onPick={() => undefined}
      />,
    );
  it('có quyền + có bước kế: nút mở menu, tên chứa trạng thái hiện tại', () => {
    const h = html(true, opts);
    expect(h).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>/);
    expect(h).toContain('In Progress');
    expect(h).toContain('min-h-11');
  });
  it('không có quyền chuyển: giá trị hiện thẳng, không phải nút vô hiệu', () => {
    const h = html(false, opts);
    expect(h).not.toContain('<button');
    expect(h).toContain('In Progress');
    expect(h).not.toContain('disabled');
  });
  it('không có bước kế: cũng chỉ hiện giá trị', () => {
    expect(html(true, [])).not.toContain('<button');
  });
});

describe('nối vào trang chi tiết (đọc source)', () => {
  const page = read('IssueDetailPage.tsx');
  it('chọn nội dung theo cỡ màn hình bằng useMediaQuery (mỗi bản chỉ dựng một lần, id không trùng)', () => {
    expect(page).toContain("useMediaQuery('(min-width: 768px)'");
    expect(page).toContain('factLayout(');
    expect(page).toMatch(/layout\.strip\.length > 0 && \(\s*<IssueKeyFacts/);
    expect(page).toMatch(/layout\.priorityInHeader && <IssuePrioritySelect/);
    expect(page).toMatch(/layout\.statusInToolbar && \(/);
  });
  it('vẫn đúng một h1; hộp chuyển trạng thái dùng chung requestTransition', () => {
    expect((page.match(/<IssueSummaryEdit/g) ?? []).length).toBe(1);
    expect(page).not.toContain('<h1');
    expect(read('IssueKeyFacts.tsx')).not.toContain('<h1');
    expect(page).toMatch(/onTransition=\{requestTransition\}/);
  });
  it('P-C1: không thêm đóng-gói cũ vào effect phím tắt (deps effect phím không đổi)', () => {
    expect(page).toContain('requestTransitionRef.current = requestTransition;');
    expect(page).toContain('copyLinkRef.current = copyLink;');
  });
  it('"Thuộc tính khác": nút có aria-expanded + aria-controls, mặc định thu gọn, nhớ theo người dùng', () => {
    const facts = read('IssueKeyFacts.tsx');
    expect(facts).toContain('aria-expanded={open}');
    expect(facts).toContain('aria-controls=');
    expect(facts).toContain('Thuộc tính khác');
    expect(facts).toContain('readOtherOpen');
    expect(facts).toContain('writeOtherOpen');
    expect(facts).not.toMatch(/localStorage\./);
  });
  it('các trường dùng đúng control + mutation của cột phải (không fork logic)', () => {
    const facts = read('IssueKeyFacts.tsx');
    expect(facts).toContain('IssueAssigneeControl');
    expect(facts).toContain('IssueDueField');
    expect(facts).toContain('IssuePrioritySelect');
    expect(facts).not.toContain('useUpdateIssue');
    const props = read('../issue-edit/IssueProperties.tsx');
    // hàng ở cột phải cũng dùng chính control đó
    expect(props).toMatch(/<IssueAssigneeControl issue=\{issue\} \/>/);
    expect(props).toContain('omit');
  });
});
