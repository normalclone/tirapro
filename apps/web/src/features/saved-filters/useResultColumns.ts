import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/stores/auth';
import {
  DEFAULT_RESULT_COLUMNS,
  RESULT_COLUMNS,
  hideColumn,
  loadColumns,
  moveColumn,
  saveColumns,
  showColumn,
  toggleColumn,
  type ResultColumnId,
} from './resultColumns';

/**
 * Bố cục cột của người dùng cho phạm vi hiện tại (`adhoc` hoặc `filter:<id>`), nhớ trong localStorage theo `userId`.
 * `columns` luôn có `key` + `summary` ở đầu. L2 (Xuất CSV) dùng chính danh sách này + `cellText`/`RESULT_COLUMNS` để xuất
 * đúng cột và thứ tự đang xem. `announce` = câu cho vùng thông báo (trình đọc màn hình) sau mỗi thao tác.
 */
export function useResultColumns(scope: string) {
  const userId = useAuth((s) => s.user?.id ?? 'anonymous');
  const [state, setState] = useState(() => ({
    userId,
    scope,
    columns: loadColumns(userId, scope),
  }));
  // Đổi người dùng / đổi bộ lọc → nạp lại bố cục của người đó, của bộ lọc đó.
  const current =
    state.userId === userId && state.scope === scope
      ? state
      : { userId, scope, columns: loadColumns(userId, scope) };
  if (current !== state) setState(current);
  const [announce, setAnnounce] = useState('');

  const apply = useCallback(
    (next: ResultColumnId[], message: string) => {
      if (next === current.columns) return;
      saveColumns(userId, scope, next);
      setState({ userId, scope, columns: next });
      setAnnounce(message);
    },
    [current.columns, userId, scope],
  );
  // Ẩn cột làm nút mở menu của chính nó biến mất → đưa focus sang tiêu đề kề (không để rơi về body).
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const focusAfterHide = useRef<ResultColumnId | null>(null);
  useEffect(() => {
    const id = focusAfterHide.current;
    if (!id) return;
    focusAfterHide.current = null;
    theadRef.current?.querySelector<HTMLElement>(`[data-col-trigger="${id}"]`)?.focus();
  }, [current.columns]);
  const labelOf = (id: ResultColumnId) => RESULT_COLUMNS.find((c) => c.id === id)!.label;
  return {
    columns: current.columns,
    announce,
    theadRef,
    toggle: (id: ResultColumnId) =>
      apply(
        toggleColumn(current.columns, id),
        current.columns.includes(id) ? `Đã ẩn cột ${labelOf(id)}` : `Đã hiện cột ${labelOf(id)}`,
      ),
    move: (id: ResultColumnId, dir: -1 | 1) => {
      const next = moveColumn(current.columns, id, dir);
      apply(
        next,
        `Đã dời cột ${labelOf(id)} sang ${dir < 0 ? 'trái' : 'phải'}, vị trí ${next.indexOf(id) + 1}/${next.length}`,
      );
    },
    hide: (id: ResultColumnId) => {
      const i = current.columns.indexOf(id);
      focusAfterHide.current = current.columns[i + 1] ?? current.columns[i - 1] ?? null;
      apply(hideColumn(current.columns, id), `Đã ẩn cột ${labelOf(id)}`);
    },
    show: (id: ResultColumnId, afterId: ResultColumnId) =>
      apply(showColumn(current.columns, id, afterId), `Đã hiện cột ${labelOf(id)}`),
    reset: () => apply([...DEFAULT_RESULT_COLUMNS], 'Đã đặt lại cột về mặc định'),
  };
}
