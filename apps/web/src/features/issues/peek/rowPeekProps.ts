import type { KeyboardEvent, MouseEvent } from 'react';
import { openOnClick, openOnRowKey } from '@/lib/rowOpen';

/**
 * onClick/onAuxClick/onKeyDown cho một hàng KHÔNG kéo thả (vd. Triage): bấm/Enter = xem nhanh, Cmd/Ctrl+bấm/Enter hoặc
 * chuột giữa = tab mới. Logic nằm ở `lib/rowOpen.ts`, dùng chung với dòng Việc chờ và thẻ Board. Riêng thẻ Board (RC15):
 * Cmd/Ctrl+click được `Card` bắt trước ở pha bắt để bật/tắt chọn nên không tới `onClick` này; Enter/Cmd+Enter và chuột
 * giữa vẫn như trên.
 */
export function rowPeekProps(issueKey: string, open: (key: string) => void) {
  return {
    onClick: (e: MouseEvent<HTMLElement>) => void openOnClick(e, issueKey, open),
    // Chuột giữa chỉ bắn `auxclick` (không bắn `click`).
    onAuxClick: (e: MouseEvent<HTMLElement>) => {
      if (e.button === 1) openOnClick(e, issueKey, open);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void openOnRowKey(e, { key: issueKey, open }),
  };
}
