import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { ResultsTable, type RowSelection } from './ResultsTable';

const SRC = join(__dirname, '../..');
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const mk = (id: string, key: string) =>
  ({
    id,
    key,
    summary: 'Việc ' + key,
    status: { name: 'Đang làm', category: 'IN_PROGRESS' },
    type: { name: 'Bug', color: '#c00' },
    projectId: 'p1',
  }) as unknown as IssueDto;
const noop = () => undefined;

function render(opts: { selected?: string[]; selection?: boolean } = {}) {
  const selection: RowSelection | undefined =
    opts.selection === false
      ? undefined
      : {
          selected: new Set(opts.selected ?? []),
          onToggle: noop,
          onRange: noop,
          onTogglePage: noop,
        };
  return renderToStaticMarkup(
    <MemoryRouter>
      <ResultsTable
        issues={[mk('i1', 'DEMO-1'), mk('i2', 'DEMO-2')]}
        loading={false}
        hasRun
        error={null}
        page={1}
        onPageChange={noop}
        projectKeyById={new Map([['p1', 'DEMO']])}
        onOpen={noop}
        selection={selection}
      />
    </MemoryRouter>,
  );
}

describe('ResultsTable — chọn nhiều', () => {
  it('mỗi dòng có ô "Chọn {MÃ}"; đầu bảng có "Chọn tất cả trên trang"', () => {
    const h = render();
    expect(h).toContain('aria-label="Chọn DEMO-1"');
    expect(h).toContain('aria-label="Chọn DEMO-2"');
    expect(h).toContain('aria-label="Chọn tất cả trên trang"');
  });
  it('ô chọn ở CỘT ĐẦU của dòng; không truyền selection thì bảng y như trước', () => {
    const h = render();
    const firstTd = /<tr[^>]*data-issue-key="DEMO-1"[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/.exec(
      h,
    )![1]!;
    expect(firstTd).toContain('Chọn DEMO-1');
    const plain = render({ selection: false });
    expect(plain).not.toContain('Chọn DEMO-1');
    expect(plain).not.toContain('Chọn tất cả');
  });
  it('trạng thái chọn: checked + data-selected; chưa chọn thì ô ẩn tới khi rê, có chọn thì luôn hiện', () => {
    const none = render();
    expect(none).toContain('group-hover/row:opacity-100');
    expect(none).toContain('opacity-0');
    const some = render({ selected: ['i1'] });
    expect(some).toMatch(
      /data-issue-key="DEMO-1"[^>]*>|data-selected=""[^>]*data-issue-key="DEMO-1"/,
    );
    expect(some).toContain('data-selected=""');
    // một việc chọn → mọi ô đều hiện (không còn opacity-0 ở ô chọn)
    expect(/data-select-box[^>]*opacity-0/.test(some)).toBe(false);
  });
  it('vùng bấm 44px trên cảm ứng, không phải nút xem nhanh (data-no-peek)', () => {
    const h = render();
    expect(h).toContain('[@media(pointer:coarse)]:after:-inset-[13px]');
    expect(h).toContain('data-no-peek');
  });
  it('đầu bảng: ô chọn tất cả có trạng thái lưng chừng (indeterminate) khi chỉ chọn một phần trang', () => {
    const s = src('features/saved-filters/ResultsTable.tsx');
    expect(s).toContain('ref.current.indeterminate = n > 0 && !all');
    expect(s).toContain('onTogglePage(');
  });
  it('Cmd/Ctrl+click dòng vẫn mở tab mới (RC15: Bộ lọc không dùng nó để chọn); phím ô chọn không nuốt phím toàn cục', () => {
    const s = src('features/saved-filters/ResultsTable.tsx');
    expect(s).toContain('rowPeekProps(issue.key, onOpen)');
    expect(s).not.toContain('selectGesture');
    expect(src('features/bulk/SelectCheckbox.tsx')).toContain('onKeyDown={stopRowKeys}');
  });
});

describe('Bộ lọc — hàng loạt nhiều dự án (nối dây)', () => {
  const page = src('features/saved-filters/FiltersPage.tsx');
  const dock = src('features/saved-filters/FiltersBulkDock.tsx');
  const hook = src('features/bulk/useGroupedBulkEdit.ts');
  it('trang: thứ tự chọn dải = các dòng đã nạp; bỏ id không còn trong kết quả; dock chỉ khi đang chọn', () => {
    expect(page).toContain('useBulkSelection(resultOrder)');
    expect(page).toMatch(/useEffect\(\(\) => \{\s*pruneSelection\(new Set\(resultOrder\)\);/);
    expect(page).toMatch(/sel\.selected\.size > 0 && \(\s*<FiltersBulkDock/);
    expect(page).toContain('selection={selectionProps}');
  });
  it('dock: ẩn Đổi người / Nhãn / Trạng thái khi nhiều dự án (không truyền handler); không Sprint/Epic', () => {
    expect(dock).toContain('av.assign.visible ?');
    expect(dock).toContain('av.label.visible ?');
    expect(dock).toContain('av.status.visible ?');
    expect(dock).not.toContain('onMoveToSprint');
    expect(dock).not.toContain('onSetEpic');
  });
  it('hook: gọi bulk theo từng dự án (song song tối đa 2), báo trước khi bỏ qua việc thiếu quyền, ghi lớp phủ, KHÔNG làm mới /search', () => {
    expect(hook).toContain('GROUP_CONCURRENCY = 2');
    expect(hook).toContain('mapLimit(');
    expect(hook).toContain('applyNotice(avail)');
    expect(hook).toContain('recordIssueChange(i)');
    expect(hook).not.toContain('keys.search');
    // mutateAsync/try-catch hoặc try/catch ở hook, không per-call mutate
    expect(hook).not.toMatch(/\.mutate\(/);
  });
});
