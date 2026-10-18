import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  dirtyGuardEntries,
  describeGuard,
  pickBlockingEntries,
  useLeaveGuardStore,
  type GuardEntry,
} from '@/stores/leaveGuard';

/**
 * Bộ chặn rời trang DUY NHẤT của cả app (mount một lần ở AppShell): một `useBlocker` + một `beforeunload`
 * phục vụ mọi `useLeaveGuard`. Router chỉ hỗ trợ một blocker nên không cho hook tự gọi `useBlocker`.
 */
export function LeaveGuardHost(): null {
  const confirm = useConfirm();
  const blocking = useRef<[string, GuardEntry][]>([]);
  const blocker = useBlocker((args) => {
    blocking.current = pickBlockingEntries(useLeaveGuardStore.getState().entries, args);
    return blocking.current.length > 0;
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const picked = blocking.current;
    void confirm({
      title: 'Bỏ các thay đổi chưa lưu?',
      description: describeGuard(picked),
      confirmLabel: 'Bỏ thay đổi',
      destructive: true,
    }).then((ok) => {
      if (!ok) return blocker.reset();
      for (const [, e] of picked) e.onDiscard();
      blocker.proceed();
    });
  }, [blocker, confirm]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const { entries, suspended } = useLeaveGuardStore.getState();
      if (suspended || dirtyGuardEntries(entries).length === 0) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return null;
}
