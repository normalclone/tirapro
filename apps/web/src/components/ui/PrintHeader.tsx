import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useMyWorkspaces } from '@/features/workspace/api';
import { useAuth } from '@/stores/auth';

/**
 * Khối CHỈ hiện khi in (`[data-print-only]` ở globals.css): tên không gian làm việc, tiêu đề báo cáo, phạm vi,
 * "In lúc dd/MM/yyyy HH:mm bởi <Tên>". Giờ in cập nhật ở `beforeprint` nên Ctrl/Cmd+P cũng đúng giờ bấm in.
 */
export function PrintHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const wsId = useAuth((s) => s.workspaceId);
  const user = useAuth((s) => s.user);
  const { data: workspaces } = useMyWorkspaces();
  const workspace = workspaces?.find((w) => w.id === wsId)?.name;
  const [at, setAt] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setAt(new Date());
    window.addEventListener('beforeprint', refresh);
    return () => window.removeEventListener('beforeprint', refresh);
  }, []);

  return (
    <div data-print-only className="mb-4 border-b border-border pb-3">
      {workspace && <p className="text-xs text-muted">{workspace}</p>}
      <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-ink">{subtitle}</p>}
      <p className="mt-1 text-xs text-muted">
        In lúc {format(at, 'dd/MM/yyyy HH:mm')}
        {user?.displayName ? ` bởi ${user.displayName}` : ''}
      </p>
    </div>
  );
}
