import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { peekPosition } from '@/lib/peekPosition';
import { PEEKED_ROW_CLS, peekedAttrs } from './peekedRow';
import { PeekNavControls } from './PeekNavControls';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');
const keys = ['A-1', 'A-2', 'A-3'];
const html = (peekKey: string | null, partial = false) =>
  renderToStaticMarkup(
    <PeekNavControls position={peekPosition(keys, peekKey, partial)} onStep={() => undefined} />,
  );
const btn = (h: string, name: string) =>
  new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`).exec(h)?.[0] ?? '';

describe('<PeekNavControls> — ‹ › và "n/N"', () => {
  it('giữa danh sách: hai nút "Việc trước"/"Việc sau" bật, "2/3" kèm nhãn "Việc 2 trên 3"', () => {
    const h = html('A-2');
    expect(btn(h, 'Việc trước')).not.toBe('');
    expect(btn(h, 'Việc sau')).not.toBe('');
    expect(btn(h, 'Việc trước')).not.toContain('aria-disabled="true"');
    expect(btn(h, 'Việc sau')).not.toContain('aria-disabled="true"');
    expect(h).toContain('2/3');
    expect(h).toContain('Việc 2 trên 3');
    expect(h).toContain('role="status"');
  });
  it('đầu danh sách: "Việc trước" vô hiệu (aria-disabled, vẫn focus được); cuối: "Việc sau" vô hiệu — không vòng', () => {
    expect(btn(html('A-1'), 'Việc trước')).toContain('aria-disabled="true"');
    expect(btn(html('A-1'), 'Việc sau')).not.toContain('aria-disabled="true"');
    expect(btn(html('A-3'), 'Việc sau')).toContain('aria-disabled="true"');
    expect(btn(html('A-3'), 'Việc sau')).not.toMatch(/ disabled[= >]/);
  });
  it('gợi ý phím j/k ở title + aria-keyshortcuts (không vòng — ghi rõ)', () => {
    const h = html('A-2');
    expect(btn(h, 'Việc trước')).toContain('aria-keyshortcuts="k"');
    expect(btn(h, 'Việc sau')).toContain('aria-keyshortcuts="j"');
    expect(btn(h, 'Việc sau')).toMatch(/title="[^"]*\(J\)/);
  });
  it('thứ tự không biết (position null) → không vẽ gì: không nút, không "n/N"', () => {
    expect(html(null)).toBe('');
    expect(html('A-9')).toBe('');
  });
  it('danh sách ảo hoá một phần: vẫn có nút nhưng KHÔNG có "n/N"', () => {
    const h = html('A-2', true);
    expect(btn(h, 'Việc sau')).not.toBe('');
    expect(h).not.toContain('2/3');
    expect(h).not.toContain('role="status"');
  });
  it('vùng chạm: dùng Button icon (36px chuột / 44px cảm ứng)', () => {
    expect(btn(html('A-2'), 'Việc sau')).toContain('pointer:coarse');
  });
});

describe('thẻ/dòng đang xem', () => {
  it('peekedAttrs: aria-current="true" khi đang xem, không có thuộc tính khi không', () => {
    expect(peekedAttrs(true)).toEqual({ 'aria-current': 'true' });
    expect(peekedAttrs(false)).toEqual({});
    expect(peekedAttrs(undefined)).toEqual({});
  });
  it('kiểu tô: nền + vòng bằng token, KHÔNG viền một bên (DESIGN.md cấm side-stripe)', () => {
    expect(PEEKED_ROW_CLS).toMatch(/bg-primary-subtle/);
    expect(PEEKED_ROW_CLS).toMatch(/ring-/);
    expect(PEEKED_ROW_CLS).not.toMatch(/border-[lrtb]\b|border-[lr]-|border-(s|e)-/);
  });
  it('Việc chờ (IssueRow) và Triage dùng cùng kiểu + aria-current; Board: Card nhận `peeked`, memo so sánh nó', () => {
    const row = read('features/backlog/IssueRow.tsx');
    expect(row).toContain('peeked && PEEKED_ROW_CLS');
    expect(row).toContain('...peekedAttrs(peeked)');
    const card = read('features/board/Card.tsx');
    expect(card).toContain('peeked && PEEKED_ROW_CLS');
    expect(card).toContain('...peekedAttrs(peeked)');
    expect(card).toContain('prev.peeked === next.peeked');
    const tri = read('features/triage/TriageRow.tsx');
    expect(tri).toContain('...peekedAttrs(peeking)');
  });
  it('Board: BoardPage chỉ đưa peekedKey vào cột CÓ việc đang xem (peekedKeyIn) → Column → Card', () => {
    const board = read('features/board/BoardPage.tsx');
    expect(board.match(/peekedKey=\{peekedKeyIn\(/g)!.length).toBe(2);
    const col = read('features/board/Column.tsx');
    expect(col).toContain('peeked={peekedKey === issue.key}');
    expect(col).toContain('p.peekedKey !== n.peekedKey');
  });
  it('danh sách ảo hoá đánh dấu data-nav-partial khi thiếu dòng trong DOM', () => {
    const bl = read('features/backlog/BacklogPage.tsx');
    expect(bl).toMatch(/data-nav-partial=\{[^}]*issues\.length/);
  });
});

describe('panel xem nhanh — nối dây', () => {
  const panel = read('features/issues/peek/IssuePeekPanel.tsx');
  const shell = read('features/issues/peek/PeekShell.tsx');
  const ctrl = read('features/issues/peek/PeekNavControls.tsx');
  it('PeekShell truyền `open` (cùng hàm j/k dùng) cho panel; không có onNavigate thì không hiện nút', () => {
    expect(shell).toContain('onNavigate={open}');
    expect(panel).toMatch(/onNavigate\?:/);
  });
  it('nút gọi ĐÚNG moveNavFocus của j/k (fromPeek, không cướp focus) — không viết đường điều hướng thứ hai', () => {
    expect(panel).toContain('moveNavFocus(dir, {');
    expect(panel).toContain('fromPeek: true');
    expect(panel).toContain('focus: false');
    expect(panel).toContain('peekKey: issueKey');
    expect(panel).toContain('onPeek: onNavigate');
    expect(panel).not.toMatch(/nextNavIndex|querySelectorAll\('\[data-nav-item\]/);
  });
  it('vị trí lấy qua hook đọc DOM + MutationObserver (childList) trên danh sách bên cạnh panel, gộp bằng rAF', () => {
    const hook = read('features/issues/peek/usePeekPosition.ts');
    expect(hook).toContain('new MutationObserver(');
    expect(hook).toContain('childList: true');
    expect(hook).toContain('requestAnimationFrame(');
    expect(hook).toContain('previousElementSibling');
    expect(hook).toContain('readNavKeys()');
    expect(hook).toContain('sameNavSnapshot(');
  });
  it('mở/đổi việc đang xem → cuộn dòng đó vào khung CHỈ khi ngoài tầm nhìn (block: nearest; scroll-behavior do reduced-motion quản)', () => {
    expect(panel).toContain("scrollIntoView({ block: 'nearest' })");
    expect(panel).not.toMatch(/behavior: 'smooth'/);
  });
  it('nhãn nút do component riêng giữ (không lặp trong panel)', () => {
    expect(ctrl).toContain('aria-label="Việc trước"');
    expect(ctrl).toContain('aria-label="Việc sau"');
  });
});
