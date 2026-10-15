import type { ReactNode } from 'react';
import { IssuePeekPanel } from './IssuePeekPanel';
import { useIssuePeek } from './useIssuePeek';

/** Bố cục hàng [nội dung | panel xem nhanh]: panel hiện khi URL có `?peek=KEY`. Dùng cho Việc chờ / Triage / Board. */
export function PeekShell({ children }: { children: ReactNode }) {
  const { peekKey, close } = useIssuePeek();
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {peekKey && <IssuePeekPanel issueKey={peekKey} onClose={close} />}
    </div>
  );
}
