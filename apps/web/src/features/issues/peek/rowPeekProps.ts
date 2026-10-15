import type { KeyboardEvent, MouseEvent } from 'react';
import { clickIsOnInteractive, rowKeyAction, wantsNewTab } from '@/lib/rowOpen';

/**
 * onClick/onKeyDown cho một hàng KHÔNG kéo thả (vd. Triage): bấm/Enter = xem nhanh, Cmd/Ctrl+bấm/Enter = tab mới.
 * Nút/link/ô nhập bên trong hàng tự xử lý; sự kiện từ portal nổi lên theo cây React thì bỏ.
 */
export function rowPeekProps(issueKey: string, open: (key: string) => void) {
  const newTab = () => window.open(`/issue/${issueKey}`, '_blank', 'noopener');
  return {
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (
        !e.currentTarget.contains(e.target as Node) ||
        clickIsOnInteractive(e.target, e.currentTarget)
      )
        return;
      if (wantsNewTab(e)) newTab();
      else open(issueKey);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const a = rowKeyAction({
        key: e.key,
        isDragging: false,
        targetIsRow: e.target === e.currentTarget,
        mod: e.metaKey || e.ctrlKey,
      });
      if (a === 'open') {
        e.preventDefault();
        open(issueKey);
      } else if (a === 'open-new-tab') {
        e.preventDefault();
        newTab();
      }
    },
  };
}
