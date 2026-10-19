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
  it('m2: giá trị thẳng hàng với nhãn (bù đệm trái của nút/chữ)', () => {
    expect(html(true, opts)).toMatch(/<button[^>]*class="[^"]*-ml-1\.5/);
    expect(html(false, opts)).toMatch(/<span[^>]*class="[^"]*-ml-1\.5/);
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
    expect(page).toContain("useMediaQuery('(min-width: 1024px)'");
    expect(page).not.toContain('min-width: 768px');
    expect(page).toContain('factLayout(');
    expect(page).toMatch(/layout\.strip\.length > 0 && \(\s*<IssueKeyFacts/);
    expect(page).toMatch(/layout\.priorityInHeader && <IssuePrioritySelect/);
    expect(page).toMatch(/layout\.statusInToolbar && \(/);
  });
  it('RC13: dải dưới lg; trong 768–1023 bốn ô nằm một hàng (cột Người phụ trách rộng hơn)', () => {
    const facts = read('IssueKeyFacts.tsx');
    expect(facts).toMatch(
      /grid-cols-2[^"]*md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.6fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)\]/,
    );
  });
  it('m1: "Xem quy trình" dưới lg nằm cạnh chip Trạng thái trong dải (giữ tên truy cập), không còn đứng một mình ở thanh nút', () => {
    const facts = read('IssueKeyFacts.tsx');
    expect(facts).toContain('onOpenWorkflow');
    expect(facts).toContain('aria-label="Xem quy trình"');
    const page = read('IssueDetailPage.tsx');
    expect(page).toMatch(/onOpenWorkflow=\{\(\) => \{/);
    // thanh nút: cả cụm trạng thái (chip, quy trình, bước kế) chỉ dựng ở bản có thanh nút
    expect(page).toMatch(
      /\{layout\.statusInToolbar && \(\s*<div className="ml-auto flex flex-wrap/,
    );
    expect((page.match(/aria-label="Xem quy trình"/g) ?? []).length).toBe(1);
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
    expect(facts).toContain('flushStart');
    const props = read('../issue-edit/IssueProperties.tsx');
    // hàng ở cột phải cũng dùng chính control đó
    expect(props).toMatch(/<IssueAssigneeControl issue=\{issue\} \/>/);
    expect(props).toContain('omit');
  });
});
