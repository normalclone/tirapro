import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

describe('PeekOrderContext — nối dây', () => {
  const ctx = read('features/issues/peek/PeekOrderContext.ts');
  const shell = read('features/issues/peek/PeekShell.tsx');
  const panel = read('features/issues/peek/IssuePeekPanel.tsx');
  const hook = read('features/issues/peek/usePeekPosition.ts');
  const hotkeys = read('lib/useGlobalHotkeys.ts');

  it('context mang thứ tự thật (keys, hasMore, loadMore, reveal) + ref tới KHUNG danh sách', () => {
    expect(ctx).toContain('export const PeekOrderContext');
    for (const f of ['keys:', 'hasMore?', 'loadMore?', 'reveal?', 'listRef'])
      expect(ctx).toContain(f);
  });
  it('PeekShell nhận `order`, cung cấp context, giữ listRef trên khung danh sách và đăng ký nguồn cho phím j/k', () => {
    expect(shell).toContain('order?: PeekOrder');
    expect(shell).toContain('PeekOrderContext.Provider');
    expect(shell).toContain('ref={listRef}');
    expect(shell).toContain('registerPeekSource(');
  });
  it('hook vị trí: có order → peekPosition(order.keys, peekKey, false, …); không thì đọc DOM; KHÔNG tìm danh sách bằng previousElementSibling', () => {
    expect(hook).toContain('peekPosition(order.keys, peekKey, false');
    expect(hook).toContain('readNavKeys(');
    expect(hook).not.toContain('previousElementSibling');
    expect(panel).not.toContain('previousElementSibling');
  });
  it('panel: tìm dòng đang xem TRONG khung danh sách (không document), reveal khi chưa vẽ, truyền order + root cho moveNavFocus', () => {
    expect(panel).toContain('listRef.current?.querySelector');
    expect(panel).not.toMatch(/document\s*\.querySelector<HTMLElement>\(`\[data-issue-key/);
    expect(panel).toContain('order?.reveal?.(issueKey)');
    expect(panel).toContain('order: order ?? undefined');
  });
  it('panel: bước tới cuối phần đã nạp thì gọi loadMore rồi tự bước khi có thêm dòng', () => {
    expect(panel).toContain('order.loadMore()');
    expect(panel).toContain('pendingMore');
  });
  it('phím j/k lấy thứ tự + khung từ cùng nguồn đã đăng ký', () => {
    expect(hotkeys).toContain('getPeekSource()');
    expect(hotkeys).toContain('order: src?.getOrder() ?? undefined');
  });
});

describe('Bộ lọc: bấm dòng = xem nhanh; Cmd/Ctrl+bấm / chuột giữa = trang đầy đủ', () => {
  const page = read('features/saved-filters/FiltersPage.tsx');
  const table = read('features/saved-filters/ResultsTable.tsx');
  it('FiltersPage bọc PeekShell, onOpen = peek.open (không navigate), cung cấp thứ tự TOÀN BỘ kết quả đã nạp + hasMore/loadMore/reveal sang trang', () => {
    expect(page).toContain('<PeekShell');
    expect(page).toContain('onOpen={peek.open}');
    expect(page).not.toContain('navigate(`/issue/');
    expect(page).toContain('(shownResults ?? []).map((i) => i.key)');
    expect(page).toContain('pageOfIndex(');
  });
  it('shownSet được memo (appendResults dựng đối tượng mới mỗi lần → effect "về trang 1" chạy liên tục, đạp reveal về trang 1)', () => {
    expect(page).toMatch(/const shownSet = useMemo\(/);
  });
  it('mã trong bảng là link thật (IssueKeyLink → <a href>); dòng dùng openOnClick (Cmd/Ctrl/chuột giữa → tab mới)', () => {
    expect(table).toContain('IssueKeyLink');
    expect(table).toContain('{...rowPeekProps(issue.key, onOpen)}'); // click/auxclick/Enter → openOnClick/openOnRowKey
  });
  it('dòng bảng và thẻ điện thoại: PEEKED_ROW_CLS + aria-current theo peekedKey', () => {
    expect(table).toContain('peeked ? PEEKED_TABLE_ROW_CLS'); // <tr>: box-shadow không vẽ được
    expect(table).toContain('peeked && PEEKED_ROW_CLS'); // thẻ điện thoại
    expect(table.match(/\.\.\.peekedAttrs\(peeked\)/g)!.length).toBe(2);
    expect(table.match(/\.\.\.rowPeekProps\(/g)!.length).toBe(2);
    expect(table).toContain('peekedKey === issue.key');
  });
});

describe('Cây việc: bấm dòng = xem nhanh, thứ tự = hàng nhìn thấy', () => {
  const tree = read('features/tree/TreePage.tsx');
  it('PeekShell + order = visibleKeys(rows); dòng mở peek, không navigate', () => {
    expect(tree).toContain('<PeekShell');
    expect(tree).toContain('visibleKeys(rows)');
    expect(tree).not.toContain('navigate(`/issue/');
    expect(tree).toContain('onOpen={peek.open}');
  });
  it('dòng: link thật + data-nav-item/data-issue-key + PEEKED_ROW_CLS + aria-current', () => {
    expect(tree).toContain('data-nav-item');
    expect(tree).toContain('data-issue-key={issue.key}');
    expect(tree).toContain('peeked ? PEEKED_ROW_CLS');
    expect(tree).toContain('...peekedAttrs(peeked)');
    expect(tree).toContain('rowPeekProps(issue.key, onOpen)');
    expect(tree).toContain('isModifiedClick(e)');
    expect(tree).toContain('<Link');
  });
});

describe('Việc chờ: thứ tự thật + cuộn ảo hoá', () => {
  const bl = read('features/backlog/BacklogPage.tsx');
  it('cung cấp order (mọi khu đang hiển thị theo thứ tự), reveal qua scrollToIndex của khu ảo hoá', () => {
    expect(bl).toContain('<PeekShell order={peekOrder}');
    expect(bl).toContain('concatKeys(');
    expect(bl).toContain('scrollToIndex(');
    expect(bl).toContain('PeekRevealContext');
  });
});
