import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from './shortcuts';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * Kho `shortcuts.ts` chỉ khai báo; nơi xử lý phím nằm rải rác. Quét mã nguồn để kho không lệch khỏi thực tế
 * (khai phím mà không nơi nào xử lý) và để guard kéo-thả của Board không bị bỏ sót.
 */
describe('kho phím tắt khớp nơi xử lý', () => {
  const handlers: Record<string, { file: string; pattern: RegExp }> = {
    'global.create': { file: 'lib/useGlobalHotkeys.ts', pattern: /case 'c':/ },
    'global.search': { file: 'lib/useGlobalHotkeys.ts', pattern: /case '\/':/ },
    'global.help': { file: 'lib/useGlobalHotkeys.ts', pattern: /case '\?':/ },
    'global.goBoard': { file: 'lib/useGlobalHotkeys.ts', pattern: /key === 'b'/ },
    'global.goBacklog': { file: 'lib/useGlobalHotkeys.ts', pattern: /key === 'l'/ },
    'global.goHome': { file: 'lib/useGlobalHotkeys.ts', pattern: /key === 'd'/ },
    'global.palette': {
      file: 'features/command/CommandPalette.tsx',
      pattern: /toLowerCase\(\) === 'k'/,
    },
    'board.next': { file: 'lib/useGlobalHotkeys.ts', pattern: /case 'j':/ },
    'board.prev': { file: 'lib/useGlobalHotkeys.ts', pattern: /case 'k':/ },
    'board.assign': { file: 'lib/useGlobalHotkeys.ts', pattern: /case 'a':/ },
    'board.edit': { file: 'lib/useGlobalHotkeys.ts', pattern: /case 'e':/ },
    'issue.assign': { file: 'lib/useGlobalHotkeys.ts', pattern: /case 'a':/ },
    'issue.edit': { file: 'features/issues/IssueDetailPage.tsx', pattern: /e\.key === 'e'/ },
    'issue.assignMe': { file: 'features/issues/IssueDetailPage.tsx', pattern: /e\.key === 'i'/ },
    'issue.copyLink': { file: 'features/issues/IssueDetailPage.tsx', pattern: /e\.key === 'y'/ },
    'issue.comment': { file: 'lib/hotkeys.ts', pattern: /e\.key === 'm'/ },
    'issue.worklog': { file: 'lib/hotkeys.ts', pattern: /e\.key === 'w'/ },
  };

  it('mỗi phím đã khai (không pending) có nơi xử lý trong mã nguồn', () => {
    for (const [id, h] of Object.entries(handlers)) {
      const def = SHORTCUTS.find((s) => s.id === id);
      expect(def, `kho thiếu ${id}`).toBeDefined();
      expect(def?.pending).toBeFalsy();
      expect(h.pattern.test(read(h.file)), `${id}: không thấy xử lý trong ${h.file}`).toBe(true);
    }
  });

  it('phím j/k/a/e của kho đều nằm trong bảng đối chiếu (thêm phím mới phải thêm nơi xử lý)', () => {
    const single = SHORTCUTS.filter((s) => !s.pending && s.scope !== 'global').map((s) => s.id);
    const known = new Set([
      ...Object.keys(handlers),
      // Xử lý ở nơi khác, đã kiểm tay: mũi tên/Enter/Space/Esc (Card, dnd-kit, peek), 1–9 (IssueDetailPage), Gantt (useBarDrag).
      'board.arrows',
      'board.open',
      'board.drag',
      'board.esc',
      'board.ganttMove',
      'board.ganttEnd',
      'board.ganttStart',
      'issue.status',
    ]);
    expect(single.filter((id) => !known.has(id))).toEqual([]);
  });

  it('Board đặt/xoá activeDrag để j/k/a/e bỏ qua khi đang nhấc thẻ (không phá kéo thả bằng phím)', () => {
    const dnd = read('features/board/BoardDnd.tsx');
    expect(dnd).toMatch(/activeDrag\.set\(String\(e\.active\.id\)\)/);
    // clearFeedback (gọi ở onDragEnd/onDragCancel và khi unmount) phải xoá activeDrag.
    expect(dnd).toMatch(/const clearFeedback = \(\) => \{[^}]*activeDrag\.set\(null\)/);
  });
});
