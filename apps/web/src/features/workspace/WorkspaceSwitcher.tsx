import { useAuth } from '@/stores/auth';
import { useMyWorkspaces } from './api';
import { WsBadge } from './WorkspaceOption';

/**
 * Tên tổ chức ở góc trái thanh trên — CHỈ hiển thị. Hệ thống chỉ có một tổ chức (2026-11-05: bỏ khái niệm
 * "workspace"), nên không còn bộ chọn, không đổi nơi, không lập tổ chức mới.
 */
export function WorkspaceSwitcher() {
  const activeId = useAuth((s) => s.workspaceId);
  const { data: workspaces = [] } = useMyWorkspaces();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const label = active?.name ?? 'Tirapro';

  return (
    <div
      className="flex h-9 max-w-[220px] items-center gap-2 px-2"
      aria-label={`Tổ chức: ${label}`}
    >
      <WsBadge name={active?.name ?? 'T'} src={active?.avatarUrl} variant="active" />
      <span className="hidden min-w-0 truncate text-sm font-semibold tracking-tight text-ink-strong sm:block">
        {label}
      </span>
    </div>
  );
}
