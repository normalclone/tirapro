import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { ResultsTable } from './ResultsTable';
import { DEFAULT_RESULT_COLUMNS, RESULT_COLUMNS } from './resultColumns';

const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');

const issue = {
  id: 'i1',
  key: 'DEMO-1',
  summary: 'Đăng nhập lỗi',
  status: { name: 'Đang làm', category: 'IN_PROGRESS' },
  type: { name: 'Bug', color: '#c00' },
  projectId: 'p1',
} as unknown as IssueDto;

const html = renderToStaticMarkup(
  <ResultsTable
    issues={[issue]}
    loading={false}
    hasRun
    error={null}
    page={1}
    onPageChange={() => undefined}
    projectKeyById={new Map([['p1', 'DEMO']])}
    onOpen={() => undefined}
  />,
);

describe('tiêu đề cột bảng kết quả — nút mở menu', () => {
  const theadCells = /<thead>[\s\S]*?<\/thead>/.exec(html)![0].split('<th ').slice(1);
  it('mỗi cột mặc định có một nút, đúng thứ tự; tên truy cập CHỈ là tên cột (không aria-label dài)', () => {
    const text = (c: string) => />([^<>]+)<svg/.exec(/<button[\s\S]*?<\/button>/.exec(c)![0])?.[1];
    expect(theadCells.map(text)).toEqual(
      DEFAULT_RESULT_COLUMNS.map((id) => RESULT_COLUMNS.find((c) => c.id === id)!.label),
    );
    for (const c of theadCells) expect(/<button[^>]*>/.exec(c)![0]).not.toContain('aria-label');
  });
  it('nút là <button type="button"> có aria-haspopup="menu"; th giữ scope="col"', () => {
    for (const c of theadCells) {
      expect(c).toMatch(/scope="col"/);
      expect(c).toMatch(/<button[^>]*type="button"/);
      expect(c).toMatch(/aria-haspopup="menu"/);
      expect(c).toMatch(/aria-expanded="false"/);
    }
  });
  it('có vùng thông báo role=status cho trình đọc màn hình', () => {
    expect(html).toMatch(/<p class="sr-only" role="status">/);
  });
  it('menu đóng thì chưa dựng mục nào', () => {
    expect(html).not.toContain('Dời trái');
  });
});

describe('ColumnHeader — nguồn', () => {
  const s = src('ColumnHeader.tsx');
  it('dùng Radix DropdownMenu (bàn phím + trả focus có sẵn) và đúng chữ tiếng Việt', () => {
    expect(s).toContain('@radix-ui/react-dropdown-menu');
    for (const t of ['Dời trái', 'Dời phải', 'Ẩn cột', 'Hiện lại cột ẩn']) expect(s).toContain(t);
  });
  it('trigger không có aria-label; ghi chú cột khoá gắn vào menu bằng aria-describedby', () => {
    const trigger = /<button[\s\S]*?>/.exec(s)![0];
    expect(trigger).not.toContain('aria-label');
    expect(s).toMatch(/aria-describedby=\{def\.locked \? noteId : undefined\}/);
    expect(s).toMatch(/<p id=\{noteId\}/);
  });
  it('mục không dùng được thì VÔ HIỆU (disabled), không giấu', () => {
    expect(s).toMatch(/disabled=\{!canMoveColumn\(columns, id, -1\)\}/);
    expect(s).toMatch(/disabled=\{!canMoveColumn\(columns, id, 1\)\}/);
    expect(s).toMatch(/disabled=\{!canHideColumn\(columns, id\)\}/);
  });
  it('"Hiện lại cột ẩn" chỉ khi có cột ẩn', () => {
    expect(s).toMatch(/hidden\.length > 0 &&/);
  });
  it('vùng chạm 44px trên con trỏ thô, có focus ring và motion-reduce', () => {
    expect(s).toContain('[@media(pointer:coarse)]:min-h-11');
    expect(s).toContain('focus-visible:ring-2');
    expect(s).toContain('motion-reduce:animate-none');
  });
});

describe('nối dây', () => {
  it('FiltersPage truyền phạm vi: bộ lọc đã lưu theo id, truy vấn nhanh là adhoc', () => {
    const s = src('FiltersPage.tsx');
    expect(s).toMatch(
      /scopeKey=\{active\.kind === 'filter' \? `filter:\$\{active\.filter\.id\}` : 'adhoc'\}/,
    );
  });
  it('CSV xuất đúng danh sách cột (thứ tự) đang xem', () => {
    expect(src('ResultsTable.tsx')).toMatch(
      /exportIssuesCsvWithToast\(\{ jql: exportJql, columns \}\)/,
    );
  });
});
